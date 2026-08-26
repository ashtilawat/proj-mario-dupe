import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { STOMP_BOUNCE, TILE_SIZE, overlaps } from '../src/physics/index.ts'
import type { Aabb, TileGrid, TileKind } from '../src/physics/index.ts'
import * as walkerModule from '../src/entities/enemies/walker.ts'
import { WALKER_HEIGHT, WALKER_WIDTH, createWalker } from '../src/entities/enemies/walker.ts'
import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../src/entities/player/index.ts'

// Rows are written top-down for readability; tile Y is up, so row 0 is the highest ty.
// '#' solid, '.' empty. Same stub shape tests/physics.test.ts uses.
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

const DT = 1 / 120

const LONG_FLOOR = makeGrid([
  '....................',
  '....................',
  '####################',
])

const WALL_AHEAD = makeGrid([
  '..........',
  '.....#....',
  '##########',
])

const LEDGE = makeGrid([
  '..........',
  '..........',
  '#####.....',
])

describe('createWalker', () => {
  test('faces the direction given by the spawn props', () => {
    // Level 1-1 spawns { type: "walker", at: [16, 1], props: { dir: -1 } }.
    const walker = createWalker({ x: 16, y: 1, dir: -1 })

    expect(walker.dir).toBe(-1)
    expect(walker.aabb.x).toBe(16)
    expect(walker.aabb.y).toBe(1)
    expect(walker.alive).toBe(true)
    expect(walker.stomped).toBe(false)
  })

  test('defaults to facing right', () => {
    expect(createWalker({ x: 3, y: 1 }).dir).toBe(1)
  })
})

describe('patrol', () => {
  test('walks in its facing direction along a long floor', () => {
    const right = createWalker({ x: 5, y: 1, dir: 1 })
    const left = createWalker({ x: 5, y: 1, dir: -1 })

    for (let i = 0; i < 60; i += 1) {
      right.step(DT, LONG_FLOOR)
      left.step(DT, LONG_FLOOR)
    }

    expect(right.aabb.x).toBeGreaterThan(5)
    expect(left.aabb.x).toBeLessThan(5)
    expect(right.dir).toBe(1)
    expect(left.dir).toBe(-1)
    // Stays resting on the floor rather than sinking or drifting up.
    expect(right.aabb.y).toBeCloseTo(1, 6)
  })

  test('reverses at a wall without overlapping it', () => {
    const walker = createWalker({ x: 2, y: 1, dir: 1 })

    for (let i = 0; i < 300; i += 1) walker.step(DT, WALL_AHEAD)

    expect(walker.dir).toBe(-1)
    // The wall tile spans x in [5, 6); the walker must stay left of it.
    expect(walker.aabb.x + walker.aabb.w).toBeLessThanOrEqual(5)
  })

  test('reverses at a ledge instead of walking off', () => {
    const walker = createWalker({ x: 1, y: 1, dir: 1 })

    for (let i = 0; i < 300; i += 1) walker.step(DT, LEDGE)

    // Floor tiles are tx 0..4, so support ends at x = 5. A one-tile lookahead also
    // treats x = 0 as a ledge, so after 300 steps the walker may already be facing
    // right again — the invariant is it never walked off.
    expect(walker.aabb.x).toBeGreaterThanOrEqual(0)
    expect(walker.aabb.x + walker.aabb.w).toBeLessThanOrEqual(5 + 1e-6)
    expect(walker.aabb.y).toBeCloseTo(1, 6)
  })

  // 1-1 floor: tiles 0-9 solid, 10-11 pit, 12-23 solid. Spawn is (16, 1) facing left.
  const ONE_ONE_FLOOR = makeGrid([
    '........................',
    '##########..############',
  ])

  test('1-1 walker walking left turns at the pit instead of falling in', () => {
    const walker = createWalker({ x: 16, y: 1, dir: -1 })

    for (let i = 0; i < 120 * 8; i += 1) walker.step(DT, ONE_ONE_FLOOR)

    expect(walker.aabb.y).toBeCloseTo(1, 5)
    expect(walker.aabb.x).toBeGreaterThanOrEqual(12)
    expect(walker.aabb.x + walker.aabb.w).toBeLessThanOrEqual(24)
  })

  test('1-1 walker patrols the right-hand shelf and never enters the pit', () => {
    const walker = createWalker({ x: 16, y: 1, dir: -1 })
    let sawLeft = false
    let sawRight = false

    for (let i = 0; i < 120 * 20; i += 1) {
      walker.step(DT, ONE_ONE_FLOOR)
      expect(walker.aabb.y).toBeCloseTo(1, 5)
      expect(walker.aabb.x).toBeGreaterThanOrEqual(12)
      expect(walker.aabb.x + walker.aabb.w).toBeLessThanOrEqual(24)
      if (walker.dir === -1) sawLeft = true
      if (walker.dir === 1) sawRight = true
    }

    expect(sawLeft).toBe(true)
    expect(sawRight).toBe(true)
  })
})

describe('stomp', () => {
  test('a stomper falling from above defeats it and gets STOMP_BOUNCE', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })
    const top = walker.aabb.y + walker.aabb.h

    // Overlapping now, but its previous bottom was clear above the walker's top.
    const bounce = walker.tryStomp({ x: 5.2, y: top - 0.1, w: 1, h: 1 }, -10, top + 0.3)

    expect(bounce).toBe(STOMP_BOUNCE)
    expect(bounce).toBe(15)
    expect(walker.alive).toBe(false)
    expect(walker.stomped).toBe(true)
    // The walker is defeated in place, not launched.
    expect(walker.velocity.y).toBe(0)
  })

  test('a hit from the side does not stomp', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    const bounce = walker.tryStomp({ x: 4.2, y: 1, w: 1, h: 1 }, 0, 1)

    expect(bounce).toBe(0)
    expect(walker.alive).toBe(true)
    expect(walker.stomped).toBe(false)
  })

  test('a hit from below does not stomp', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    const bounce = walker.tryStomp({ x: 5.2, y: 0.2, w: 1, h: 1 }, 8, 0.1)

    expect(bounce).toBe(0)
    expect(walker.alive).toBe(true)
  })

  test('a falling stomper already beside the walker does not stomp', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    // Moving down and overlapping, but its previous bottom was below the walker's top:
    // this is scraping down the side, not landing on the head.
    const bounce = walker.tryStomp({ x: 4.2, y: 1.4, w: 1, h: 1 }, -10, 1.5)

    expect(bounce).toBe(0)
    expect(walker.alive).toBe(true)
  })

  test('a non-overlapping stomper from above does not stomp', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    const bounce = walker.tryStomp({ x: 5.2, y: 3, w: 1, h: 1 }, -10, 3.5)

    expect(bounce).toBe(0)
    expect(walker.alive).toBe(true)
  })

  test('a defeated walker stops patrolling', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })
    for (let i = 0; i < 30; i += 1) walker.step(DT, LONG_FLOOR)

    const top = walker.aabb.y + walker.aabb.h
    walker.tryStomp({ x: walker.aabb.x, y: top - 0.1, w: 1, h: 1 }, -10, top + 0.3)
    const restingX = walker.aabb.x

    for (let i = 0; i < 120; i += 1) walker.step(DT, LONG_FLOOR)

    expect(walker.aabb.x).toBe(restingX)
    expect(walker.velocity.x).toBe(0)
  })

  test('a defeated walker cannot be stomped again', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })
    const top = walker.aabb.y + walker.aabb.h

    expect(walker.tryStomp({ x: 5.2, y: top - 0.1, w: 1, h: 1 }, -10, top + 0.3)).toBe(STOMP_BOUNCE)
    expect(walker.tryStomp({ x: 5.2, y: top - 0.1, w: 1, h: 1 }, -10, top + 0.3)).toBe(0)
  })
})

describe('mushroom mesh', () => {
  /** One flat-coloured part of the merged geometry: its colour, Y span, and half-width. */
  interface Part {
    color: [number, number, number]
    minY: number
    maxY: number
    halfWidth: number
    vertices: number
  }

  /**
   * Split the merged geometry into parts by vertex colour, topmost first. Partitioning by
   * colour rather than by a Y band is what lets the neck-overlap test see the join: the
   * two parts' Y spans are allowed to intersect.
   */
  function meshParts(geometry: THREE.BufferGeometry): Part[] {
    const position = geometry.getAttribute('position')
    const color = geometry.getAttribute('color')
    const byColor = new Map<string, Part>()

    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i)
      const halfWidth = Math.abs(position.getX(i))
      const rgb: [number, number, number] = [color.getX(i), color.getY(i), color.getZ(i)]
      const part = byColor.get(rgb.join(','))

      if (part) {
        part.minY = Math.min(part.minY, y)
        part.maxY = Math.max(part.maxY, y)
        part.halfWidth = Math.max(part.halfWidth, halfWidth)
        part.vertices += 1
      } else {
        byColor.set(rgb.join(','), { color: rgb, minY: y, maxY: y, halfWidth, vertices: 1 })
      }
    }

    return [...byColor.values()].sort((a, b) => b.maxY - a.maxY)
  }

  /** The cap (topmost part) and the stem below it. */
  function capAndStem(geometry: THREE.BufferGeometry): [Part, Part] {
    const parts = meshParts(geometry)
    expect(parts).toHaveLength(2)
    return [parts[0]!, parts[1]!]
  }

  // main.ts disposes walker.mesh.geometry and walker.mesh.material directly, so the mesh
  // must stay one Mesh with one geometry and one non-array material or those calls leak.
  test('is one Mesh with a single Lambert material and no geometry groups', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    expect(walker.mesh).toBeInstanceOf(THREE.Mesh)
    expect(walker.mesh.children).toHaveLength(0)
    expect(Array.isArray(walker.mesh.material)).toBe(false)
    expect(walker.mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(walker.mesh.material).not.toBeInstanceOf(THREE.MeshStandardMaterial)
    // Two parts are drawn by one material, so vertex colours carry the difference.
    expect(walker.mesh.material.vertexColors).toBe(true)
    // Must stay white: Lambert multiplies material.color by the vertex colour, so any
    // tint here would darken both the cap and the stem.
    expect(walker.mesh.material.color.getHex()).toBe(0xffffff)
    // Groups would demand a material array, which main.ts's single dispose() cannot free.
    expect(walker.mesh.geometry.groups).toHaveLength(0)
  })

  test('carries a per-vertex colour attribute', () => {
    const geometry = createWalker({ x: 5, y: 1, dir: 1 }).mesh.geometry

    expect(geometry.type).toBe('BufferGeometry')
    const color = geometry.getAttribute('color')
    expect(color).toBeDefined()
    expect(color.itemSize).toBe(3)
    expect(color.count).toBe(geometry.getAttribute('position').count)
  })

  test('reads as a mushroom: the cap overhangs a narrower stem', () => {
    const [cap, stem] = capAndStem(createWalker({ x: 5, y: 1, dir: 1 }).mesh.geometry)

    expect(stem.halfWidth).toBeLessThan(cap.halfWidth)
    // The stem hangs below the cap rather than beside it.
    expect(stem.minY).toBeLessThan(cap.minY)
    expect(cap.maxY).toBeGreaterThan(stem.maxY)
  })

  test('overlaps at the neck, so the join cannot open a seam', () => {
    const [cap, stem] = capAndStem(createWalker({ x: 5, y: 1, dir: 1 }).mesh.geometry)

    // The stem's top sits inside the cap, not flush with its underside or short of it.
    expect(stem.maxY).toBeGreaterThan(cap.minY)
  })

  test('paints exactly two colours: a red cap over a pale stem', () => {
    const [cap, stem] = capAndStem(createWalker({ x: 5, y: 1, dir: 1 }).mesh.geometry)
    // Every vertex of each part carries that part's colour.
    expect(cap.vertices + stem.vertices).toBe(48)

    // Ratios only: THREE converts hex through the working colour space, so absolute
    // channel values depend on ColorManagement rather than on the art.
    const [capR, capG, capB] = cap.color
    expect(capR).toBeGreaterThan(capG)
    expect(capR).toBeGreaterThan(capB)

    // The stem is a pale cream, not a second red: far less saturated than the cap.
    const [stemR, stemG, stemB] = stem.color
    expect(stemG).toBeGreaterThan(capG)
    expect(stemB).toBeGreaterThan(capB)
    expect(stemG).toBeGreaterThan(0.5 * stemR)
    expect(stemB).toBeGreaterThan(0.5 * stemR)
  })

  test('still fills exactly one tile, centred on the origin', () => {
    const geometry = createWalker({ x: 5, y: 1, dir: 1 }).mesh.geometry

    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.x).toBeCloseTo(-0.5 * TILE_SIZE, 6)
    expect(box.max.x).toBeCloseTo(0.5 * TILE_SIZE, 6)
    expect(box.min.y).toBeCloseTo(-0.5 * TILE_SIZE, 6)
    expect(box.max.y).toBeCloseTo(0.5 * TILE_SIZE, 6)
    expect(box.min.z).toBeCloseTo(-0.5 * TILE_SIZE, 6)
    expect(box.max.z).toBeCloseTo(0.5 * TILE_SIZE, 6)
  })

  test('sits on the gameplay plane, synced from the hitbox', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    expect(walker.mesh.position.z).toBe(0)

    // World units: TILE_SIZE per tile, mesh centred on the AABB.
    expect(walker.mesh.position.x).toBeCloseTo((5 + walker.aabb.w / 2) * TILE_SIZE, 6)
    expect(walker.mesh.position.y).toBeCloseTo((1 + walker.aabb.h / 2) * TILE_SIZE, 6)

    for (let i = 0; i < 60; i += 1) walker.step(DT, LONG_FLOOR)

    expect(walker.mesh.position.x).toBeCloseTo((walker.aabb.x + walker.aabb.w / 2) * TILE_SIZE, 6)
    expect(walker.mesh.position.y).toBeCloseTo((walker.aabb.y + walker.aabb.h / 2) * TILE_SIZE, 6)
  })
})

/**
 * The gameplay hitbox, pinned against the art.
 *
 * Everything else in this file reads the AABB relatively (`aabb.x + aabb.w`) or against
 * itself (the mesh-sync test positions the mesh FROM `aabb.w`), so nothing says what the
 * hitbox is meant to measure. An AABB taken from the mushroom's world bounding box would
 * make the walker sixteen tiles wide — one touch, every life, no way past to the flag —
 * and the suite would only complain sideways, about patrol. These are the absolute pins:
 * the hitbox is 1x1 in TILE space, and the cap cannot enlarge it.
 */
describe('hitbox', () => {
  /** The 1-1 walker: { type: "walker", at: [16, 1], props: { dir: -1 } }. */
  function walker1x1() {
    return createWalker({ x: 16, y: 1, dir: -1 })
  }

  /** The merged mushroom geometry's own bounds, in WORLD units (TILE_SIZE per tile). */
  function meshWorldBounds(geometry: THREE.BufferGeometry) {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    return { width: box.max.x - box.min.x, height: box.max.y - box.min.y }
  }

  test('is exactly one tile, in tile units, from the spawn point', () => {
    expect(walker1x1().aabb).toEqual({ x: 16, y: 1, w: 1, h: 1 })
    expect(WALKER_WIDTH).toBe(1)
    expect(WALKER_HEIGHT).toBe(1)
  })

  test('is built from the hitbox constants, not from the mesh', () => {
    const walker = walker1x1()

    expect(walker.aabb.w).toBe(WALKER_WIDTH)
    expect(walker.aabb.h).toBe(WALKER_HEIGHT)
  })

  test('is not a copy of the cap mesh world bounds', () => {
    const walker = walker1x1()
    const mesh = meshWorldBounds(walker.mesh.geometry)

    // The mushroom spans one tile of ART, which is TILE_SIZE world units — sixteen times
    // the hitbox number. Same silhouette, different space: assigning the mesh bounds to
    // the AABB is the bug this test exists to catch.
    expect(mesh.width).toBeCloseTo(TILE_SIZE, 6)
    expect(mesh.height).toBeCloseTo(TILE_SIZE, 6)
    expect(walker.aabb.w).not.toBe(mesh.width)
    expect(walker.aabb.h).not.toBe(mesh.height)
    expect(walker.aabb.w * TILE_SIZE).toBeCloseTo(mesh.width, 6)
    expect(walker.aabb.h * TILE_SIZE).toBeCloseTo(mesh.height, 6)
  })

  test('is never scaled into world units', () => {
    const walker = walker1x1()

    expect(walker.aabb.w).not.toBe(TILE_SIZE)
    expect(walker.aabb.h).not.toBe(TILE_SIZE)
  })

  test('the cap buys the walker no reach past its own tile', () => {
    const walker = walker1x1()
    // Probes are anchored to the tile the walker spawned on — [16, 17] x [1, 2] — never to
    // `walker.aabb.w`. Measuring the box against itself is how an inflated hitbox hides.
    const beside = (probe: Aabb) => overlaps(probe, walker.aabb)

    // Real player boxes, laid flush against each face. Touching edges are not an overlap,
    // so flush means "just outside".
    const player = { w: PLAYER_WIDTH, h: PLAYER_HEIGHT }
    expect(beside({ x: 16 - PLAYER_WIDTH, y: 1, ...player })).toBe(false)
    expect(beside({ x: 17, y: 1, ...player })).toBe(false)
    expect(beside({ x: 16, y: 2, ...player })).toBe(false)

    // ...and one that really is inside it, so the probes above are not vacuously false.
    expect(beside({ x: 16.2, y: 1, ...player })).toBe(true)
  })

  // Across all three grids, so the wall-bounce and ledge-turn branches of `step` are
  // covered too, not just the straight walk.
  test.each([
    ['a long floor', LONG_FLOOR],
    ['a wall to bounce off', WALL_AHEAD],
    ['a ledge to turn at', LEDGE],
  ])('keeps its size while patrolling %s', (_label, grid) => {
    const walker = createWalker({ x: 3, y: 1, dir: 1 })

    for (let i = 0; i < 120; i += 1) walker.step(DT, grid)

    expect(walker.aabb.w).toBe(1)
    expect(walker.aabb.h).toBe(1)
  })
})

describe('module surface', () => {
  test('exports exactly one enemy class', () => {
    const classes = Object.entries(walkerModule)
      .filter(([, value]) => typeof value === 'function' && /^[A-Z]/.test(value.name))
      .map(([name]) => name)

    expect(classes).toEqual(['Walker'])
  })

  test('walker.ts is the only file under src/entities/enemies', () => {
    const files = import.meta.glob('../src/entities/enemies/*.ts')

    expect(Object.keys(files).sort()).toEqual(['../src/entities/enemies/walker.ts'])
  })
})
