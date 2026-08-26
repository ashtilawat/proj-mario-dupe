import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  MESH_SPAN_X,
  MESH_SPAN_Y,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  createPlayerMesh,
} from '../src/entities/player/player.ts'

/** One flat-coloured part of the merged geometry: its colour and local bounds. */
interface Part {
  color: THREE.Color
  minX: number
  maxX: number
  minY: number
  maxY: number
  maxZ: number
}

/**
 * Split the merged geometry into parts by vertex colour, topmost first. The same partition
 * player-art.test.ts uses, kept local so the two suites can be read on their own.
 */
function meshParts(geometry: THREE.BufferGeometry): Part[] {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  const byColor = new Map<string, Part>()

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const key = [color.getX(i), color.getY(i), color.getZ(i)].join(',')
    const part = byColor.get(key)

    if (part) {
      part.minX = Math.min(part.minX, x)
      part.maxX = Math.max(part.maxX, x)
      part.minY = Math.min(part.minY, y)
      part.maxY = Math.max(part.maxY, y)
      part.maxZ = Math.max(part.maxZ, z)
    } else {
      const rgb = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i))
      byColor.set(key, { color: rgb, minX: x, maxX: x, minY: y, maxY: y, maxZ: z })
    }
  }

  return [...byColor.values()].sort((a, b) => b.maxY - a.maxY)
}

/**
 * The lantern is the only thing Pip holds clear of the centre line — every body part
 * straddles it — so "never reaches back across x = 0" identifies the prop without either
 * suite having to know the palette's hex values or the part table's ordering.
 */
function lanternParts(geometry: THREE.BufferGeometry): Part[] {
  return meshParts(geometry).filter((part) => part.minX >= 0)
}

function bodyParts(geometry: THREE.BufferGeometry): Part[] {
  return meshParts(geometry).filter((part) => part.minX < 0 && part.maxX > 0)
}

/** The body part the lantern hangs against: the one whose Y span contains the paper. */
function partBehind(geometry: THREE.BufferGeometry, mid: number): Part {
  return bodyParts(geometry).find((part) => part.minY < mid && part.maxY > mid)!
}

describe('the lantern Pip carries', () => {
  test('adds a handle and a paper body, and nothing else', () => {
    const geometry = createPlayerMesh().geometry

    expect(lanternParts(geometry)).toHaveLength(2)
    // Prop plus body accounts for the whole mesh, so a part that is neither — one parked
    // exactly on the centre line, say — cannot slip past both suites unmeasured.
    expect(meshParts(geometry)).toHaveLength(lanternParts(geometry).length + bodyParts(geometry).length)
  })

  test('is warm paper: not the hat red, not the overalls blue', () => {
    const [handle, paper] = lanternParts(createPlayerMesh().geometry) as [Part, Part]

    // Channel ratios rather than hex: THREE.Color runs a hex through the working colour
    // space, so the stored values are not the literals in player.ts.
    // Lit paper is bright in red AND green — the hat is red with green near zero, and the
    // overalls lead in blue. Blue trails here, which is what makes the paper warm.
    expect(paper.color.r).toBeGreaterThan(0.5)
    expect(paper.color.g).toBeGreaterThan(0.5)
    expect(paper.color.b).toBeLessThan(paper.color.g)
    // The bail that carries it is the same warm family, several stops down, so it reads as
    // a separate object against the paper instead of glowing with it.
    expect(handle.color.r).toBeGreaterThan(handle.color.g)
    expect(handle.color.g).toBeGreaterThan(handle.color.b)
    expect(handle.color.r).toBeLessThan(paper.color.r / 2)

    const head = partBehind(createPlayerMesh().geometry, 0.2)
    const shoes = bodyParts(createPlayerMesh().geometry).at(-1)!
    // Paler than the head's yellow in both green and blue: the two warm tones are adjacent,
    // and lit paper drifting into skin tone would lose the lantern against the character.
    expect(paper.color.g).toBeGreaterThan(head.color.g)
    expect(paper.color.b).toBeGreaterThan(head.color.b)
    // The bail is dark, but not so dark it joins the boots — the shoes stay the character's
    // darkest note, which is what keeps the silhouette bottom-weighted.
    expect(handle.color.r).toBeGreaterThan(shoes.color.r)
  })

  test('hangs from the handle in front of the torso, at hand height', () => {
    const geometry = createPlayerMesh().geometry
    const [handle, paper] = lanternParts(geometry) as [Part, Part]
    const overalls = partBehind(geometry, (paper.minY + paper.maxY) / 2)

    // Held out front, so the turn swings it around the body rather than hiding it.
    expect(paper.maxX).toBeCloseTo(MESH_SPAN_X / 2, 6)
    expect(paper.maxX).toBeGreaterThan(overalls.maxX)
    // The bail hangs within the paper's own width — anywhere else and it is a stray bar
    // near the lantern rather than the thing the lantern hangs from.
    expect(handle.minX).toBeGreaterThanOrEqual(paper.minX)
    expect(handle.maxX).toBeLessThanOrEqual(paper.maxX)
    // Carried, not floating: the paper hangs inside the torso's own Y span, and reaches back
    // far enough to touch the body rather than drifting off the front of it.
    expect(paper.minX).toBeLessThan(overalls.maxX)
    expect(paper.maxY).toBeLessThan(overalls.maxY)
    expect(paper.minY).toBeGreaterThan(overalls.minY)
    // The handle rises from the paper to the hand, and overlaps it so no seam can open.
    expect(handle.maxY).toBeGreaterThan(paper.maxY)
    expect(handle.minY).toBeLessThan(paper.maxY)
    // Pip has no arms, so the grip is implied by where the bail stops: at the top of the
    // overalls, not short of it as a stub and not up level with the head.
    expect(handle.maxY).toBeLessThanOrEqual(overalls.maxY)
    expect(handle.maxY).toBeGreaterThan(overalls.maxY - 0.1)
    // A lantern, not a plank: taller than it is wide, and not a sliver.
    expect(paper.maxY - paper.minY).toBeGreaterThan(paper.maxX - paper.minX)
    expect(paper.maxX - paper.minX).toBeGreaterThan(0.1)
  })

  test('stays in front of the hip instead of sinking into it', () => {
    const geometry = createPlayerMesh().geometry
    const [handle, paper] = lanternParts(geometry) as [Part, Part]
    const overalls = partBehind(geometry, (paper.minY + paper.maxY) / 2)

    // The camera is orthographic and dead-on +Z (render/index.ts), so screen space is the XY
    // plane and depth decides what survives. The lantern overlaps the hip in X, so unless it
    // reaches nearer the camera than the overalls do, the depth test eats the buried half and
    // ships a narrow tab: authored width is not visible width.
    expect(paper.maxZ).toBeGreaterThan(overalls.maxZ)
    // The bail is deliberately thin, so it can never win that contest — it clears the torso
    // in X instead.
    expect(handle.minX).toBeGreaterThanOrEqual(overalls.maxX)
  })

  test('leaves the mesh one geometry under one material', () => {
    const mesh = createPlayerMesh()

    // Restated here because the lantern is the change most likely to reach for a Group: a
    // Group would slip past the `mesh.geometry.dispose()` idiom and would not be one object
    // for squash and stretch to scale.
    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect(mesh.children).toHaveLength(0)
    expect(Array.isArray(mesh.material)).toBe(false)
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(mesh.material.vertexColors).toBe(true)
    expect(mesh.geometry.groups).toHaveLength(0)
  })

  test('costs the silhouette and the hitbox nothing', () => {
    const geometry = createPlayerMesh().geometry
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())

    expect(size.x).toBeLessThanOrEqual(MESH_SPAN_X + 1e-9)
    expect(size.y).toBeCloseTo(MESH_SPAN_Y, 6)
    expect(geometry.boundingBox!.min.z).toBeGreaterThanOrEqual(-MESH_SPAN_X)
    expect(geometry.boundingBox!.max.z).toBeLessThanOrEqual(MESH_SPAN_X)
    expect(PLAYER_WIDTH).toBe(0.7)
    expect(PLAYER_HEIGHT).toBe(1.5)
  })
})
