import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, TILE_SIZE } from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import {
  JUMP_STRETCH,
  LAND_SQUASH_MAX,
  MESH_SPAN_X,
  MESH_SPAN_Y,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  createPlayer,
  createPlayerMesh,
} from '../src/entities/player/player.ts'
import type { Player, PlayerInput } from '../src/entities/player/index.ts'

function makeGrid(rows: string[]): TileGrid {
  const height = rows.length
  const width = rows[0]?.length ?? 0

  return {
    width,
    height,
    tileSize: TILE_SIZE,
    getTile(tx: number, ty: number): TileKind {
      const row = rows[height - 1 - ty]
      return row?.[tx] === '#' ? 'solid' : 'empty'
    },
  }
}

function flatGround(width: number, height: number): TileGrid {
  const rows = Array.from({ length: height }, () => '.'.repeat(width))
  rows[height - 1] = '#'.repeat(width)
  return makeGrid(rows)
}

function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { jump: false, dash: false, moveX: 0, ...partial }
}

function stepFor(player: Player, frames: number, held: PlayerInput = input()): void {
  for (let i = 0; i < frames; i += 1) player.step(FIXED_DT, held)
}

/** A player standing at rest on flat ground, built with the real default mesh. */
function onGround(): Player {
  const player = createPlayer({ x: 2, y: 1, grid: flatGround(64, 12) })
  stepFor(player, 2)
  return player
}

/** One flat-coloured part of the merged geometry: its colour and local bounds. */
interface Part {
  color: THREE.Color
  minX: number
  maxX: number
  minY: number
  maxY: number
  halfWidth: number
}

/**
 * Split the merged geometry into parts by vertex colour, topmost first. Partitioning by
 * colour rather than by a Y band is what lets the seam test see the joins: adjacent parts'
 * Y spans are allowed to intersect.
 */
function meshParts(geometry: THREE.BufferGeometry): Part[] {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  const byColor = new Map<string, Part>()

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const key = [color.getX(i), color.getY(i), color.getZ(i)].join(',')
    const part = byColor.get(key)

    if (part) {
      part.minX = Math.min(part.minX, x)
      part.maxX = Math.max(part.maxX, x)
      part.minY = Math.min(part.minY, y)
      part.maxY = Math.max(part.maxY, y)
      part.halfWidth = Math.max(part.halfWidth, Math.abs(x))
    } else {
      const rgb = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i))
      byColor.set(key, { color: rgb, minX: x, maxX: x, minY: y, maxY: y, halfWidth: Math.abs(x) })
    }
  }

  return [...byColor.values()].sort((a, b) => b.maxY - a.maxY)
}

describe('player character mesh', () => {
  test('is one Mesh with a single Lambert material and no geometry groups', () => {
    const mesh = createPlayerMesh()

    expect(mesh).toBeInstanceOf(THREE.Mesh)
    // A Group of child meshes would slip past the `mesh.geometry.dispose()` idiom, and would
    // not be one object for squash and stretch to scale.
    expect(mesh.children).toHaveLength(0)
    expect(Array.isArray(mesh.material)).toBe(false)
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(mesh.material.vertexColors).toBe(true)
    // Must stay white: Lambert multiplies material.color by the vertex colour, so any tint
    // here would darken the hat, head, overalls and shoes alike.
    expect(mesh.material.color.getHex()).toBe(0xffffff)
    // Groups would demand a material array, which a single dispose() cannot free.
    expect(mesh.geometry.groups).toHaveLength(0)
  })

  test('carries a per-vertex colour attribute', () => {
    const geometry = createPlayerMesh().geometry

    expect(geometry.type).toBe('BufferGeometry')
    const color = geometry.getAttribute('color')
    expect(color).toBeDefined()
    expect(color.itemSize).toBe(3)
    expect(color.count).toBe(geometry.getAttribute('position').count)
  })

  test('is a multi-coloured character, not the flat yellow capsule', () => {
    const mesh = createPlayerMesh()

    expect(mesh.geometry).not.toBeInstanceOf(THREE.CapsuleGeometry)
    // Crown, brim, head, overalls, shoes: the capsule had exactly one colour.
    expect(meshParts(mesh.geometry)).toHaveLength(5)
  })

  test('fills its own silhouette bounds, centred on the origin', () => {
    const geometry = createPlayerMesh().geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const size = box.getSize(new THREE.Vector3())

    // Measured against the art's own spans, not the hitbox: the whole point of MESH_SPAN_* is
    // that retuning PLAYER_HEIGHT must not drag the character with it.
    expect(size.y).toBeCloseTo(MESH_SPAN_Y, 6)
    expect(size.x).toBeLessThanOrEqual(MESH_SPAN_X + 1e-9)
    // A width floor too: `size.x <= MESH_SPAN_X` alone is satisfied by a sliver.
    expect(size.x).toBeGreaterThan(MESH_SPAN_X / 2)
    // Depth is bounded as well, or a part could balloon towards the camera unnoticed.
    expect(box.min.z).toBeGreaterThanOrEqual(-MESH_SPAN_X)
    expect(box.max.z).toBeLessThanOrEqual(MESH_SPAN_X)
    // step() parks the mesh on the hitbox centre, so an off-centre silhouette would sink the
    // feet into the floor or float them above it.
    const center = box.getCenter(new THREE.Vector3())
    expect(center.y).toBeCloseTo(0, 6)
  })

  test('the art fits inside the hitbox', () => {
    // The ONE place the art is tied to the hitbox, so the coupling is stated rather than
    // smeared across every dimension assertion.
    expect(MESH_SPAN_X).toBeLessThanOrEqual(PLAYER_WIDTH)
    expect(MESH_SPAN_Y).toBeLessThanOrEqual(PLAYER_HEIGHT)
  })

  test('is painted in the character palette, not arbitrary colours', () => {
    const [crown, brim, head, overalls, shoes] = meshParts(createPlayerMesh().geometry) as [
      Part,
      Part,
      Part,
      Part,
      Part,
    ]

    // Asserted as channel ratios, not hex: THREE.Color runs a hex through the working colour
    // space, so the stored values are not the literals in player.ts.
    for (const red of [crown, brim]) {
      expect(red.color.r).toBeGreaterThan(red.color.g)
      expect(red.color.r).toBeGreaterThan(red.color.b)
    }
    // The brim is the shaded underside of the same hat, so it must be darker but still red.
    expect(brim.color.r).toBeLessThan(crown.color.r)
    // The head keeps the established player yellow, so the player stays the only yellow thing
    // on screen and the T-021 colour language survives.
    expect(head.color.r).toBeGreaterThan(head.color.b)
    expect(head.color.g).toBeGreaterThan(head.color.b)
    expect(overalls.color.b).toBeGreaterThan(overalls.color.r)
    expect(overalls.color.b).toBeGreaterThan(overalls.color.g)
    expect(shoes.color.r).toBeGreaterThan(shoes.color.g)
    expect(shoes.color.g).toBeGreaterThan(shoes.color.b)
    // Shoes are the darkest part: a bright sole would fight the silhouette.
    expect(shoes.color.r).toBeLessThan(crown.color.r)
  })

  test('reads as a character: the brim overhangs both the crown and the head', () => {
    const parts = meshParts(createPlayerMesh().geometry)
    const [crown, brim, head] = parts as [Part, Part, Part]
    const shoes = parts[parts.length - 1]!

    // Wide-over-narrow, twice: this is what makes the top say "hat" rather than "block".
    // The brim carries its own colour precisely so this overhang is visible to a test — with
    // one shared hat colour the two parts merge and a brimless slab sails through.
    expect(brim.halfWidth).toBeGreaterThan(crown.halfWidth)
    expect(brim.halfWidth).toBeGreaterThan(head.halfWidth)
    expect(crown.maxY).toBeCloseTo(MESH_SPAN_Y / 2, 6)
    expect(shoes.minY).toBeCloseTo(-MESH_SPAN_Y / 2, 6)
  })

  test('overlaps at every join, so no seam can open', () => {
    const parts = meshParts(createPlayerMesh().geometry)

    for (let i = 0; i < parts.length - 1; i += 1) {
      const upper = parts[i]!
      const lower = parts[i + 1]!
      expect(lower.maxY).toBeGreaterThan(upper.minY)
    }
  })

  test('has a front, so the facing turn is visible', () => {
    const parts = meshParts(createPlayerMesh().geometry)
    const brim = parts[1]!
    const shoes = parts[parts.length - 1]!

    // The capsule was rotationally symmetric about Y, so player.ts's TURN_RATE lerp on
    // mesh.rotation.y drew nothing. Front-heavy shoes and brim make the turn legible.
    expect(brim.maxX).toBeGreaterThan(Math.abs(brim.minX))
    expect(shoes.maxX).toBeGreaterThan(Math.abs(shoes.minX))
  })
})

describe('player art leaves the simulation alone', () => {
  test('the default mesh is the character', () => {
    const player = createPlayer({ x: 2, y: 1, grid: flatGround(16, 8) })

    expect(player.mesh).toBeInstanceOf(THREE.Mesh)
    expect((player.mesh as THREE.Mesh).geometry.getAttribute('color')).toBeDefined()
  })

  test('honours an injected mesh, so tests can still stub it', () => {
    const stub = new THREE.Object3D()
    const player = createPlayer({ x: 2, y: 1, grid: flatGround(16, 8), mesh: stub })

    expect(player.mesh).toBe(stub)
  })

  test('keeps the T-026 stretch on the real default mesh', () => {
    const player = onGround()
    player.step(FIXED_DT, input({ jump: true }))

    // player-feel.test.ts already covers this on the default mesh; pinned here too so an art
    // change that broke root scaling fails in the art suite rather than somewhere else.
    expect(player.mesh.scale.y).toBeCloseTo(1 + JUMP_STRETCH, 10)
    expect(player.mesh.scale.x).toBeCloseTo(1 / Math.sqrt(player.mesh.scale.y), 10)
    expect(player.mesh.scale.z).toBeCloseTo(player.mesh.scale.x, 10)
  })

  test('keeps the T-026 landing squash and recovers to identity', () => {
    const player = onGround()
    player.step(FIXED_DT, input({ jump: true }))

    let squashed = 1
    for (let i = 0; i < 400; i += 1) {
      player.step(FIXED_DT, input())
      if (player.grounded && player.mesh.scale.y < 1) {
        squashed = Math.min(squashed, player.mesh.scale.y)
        break
      }
    }

    expect(squashed).toBeLessThan(1)
    expect(squashed).toBeGreaterThanOrEqual(1 - LAND_SQUASH_MAX)

    // moveToward snaps to the target, so the mesh settles bit-exactly back to identity.
    stepFor(player, 60)
    expect(player.mesh.scale.x).toBe(1)
    expect(player.mesh.scale.y).toBe(1)
    expect(player.mesh.scale.z).toBe(1)
  })

  test('never resizes the hitbox, before or after squash and stretch', () => {
    expect(PLAYER_WIDTH).toBe(0.7)
    expect(PLAYER_HEIGHT).toBe(1.5)

    const player = createPlayer({ x: 2, y: 1, grid: flatGround(64, 12) })
    expect(player.body.aabb.w).toBe(PLAYER_WIDTH)
    expect(player.body.aabb.h).toBe(PLAYER_HEIGHT)

    stepFor(player, 2)
    player.step(FIXED_DT, input({ jump: true }))
    let sawScaledMesh = false
    for (let i = 0; i < 400; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1 }))
      if (player.mesh.scale.y !== 1) sawScaledMesh = true
      // The mesh is decoration: scaling it must never feed back into what collides.
      expect(player.body.aabb.w).toBe(PLAYER_WIDTH)
      expect(player.body.aabb.h).toBe(PLAYER_HEIGHT)
    }

    expect(sawScaledMesh).toBe(true)
  })
})
