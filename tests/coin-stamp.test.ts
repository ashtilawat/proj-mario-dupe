// T-059 — the coin's art suite, in tests/ because vitest.config.ts pins include to tests/**:
// the colocated coin.test.ts does not run in CI, so the assertions that gate this ticket live
// here. Everything below reaches the geometry through createCoin().mesh; coin.ts exports no
// new name, so pickups/index.ts needs no change.

import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  COIN_COLOR,
  COIN_HEIGHT,
  COIN_SPIN_SPEED,
  COIN_WIDTH,
  createCoin,
} from '../src/entities/pickups/coin.ts'
import { TILE_SIZE } from '../src/physics/index.ts'

/** One flat-coloured part of the merged disc: its colour and its radial extent. */
interface Part {
  color: THREE.Color
  minRadius: number
  maxRadius: number
}

/**
 * Split the merged geometry into parts by vertex colour, outermost first. Partitioning by
 * colour rather than by a radius band is what lets the nesting test see the joins: the rim's
 * inner edge and the face's outer edge sit at exactly the same radius.
 */
function meshParts(geometry: THREE.BufferGeometry): Part[] {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  const byColor = new Map<string, Part>()

  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i))
    const key = [color.getX(i), color.getY(i), color.getZ(i)].join(',')
    const part = byColor.get(key)

    if (part) {
      part.minRadius = Math.min(part.minRadius, radius)
      part.maxRadius = Math.max(part.maxRadius, radius)
    } else {
      const rgb = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i))
      byColor.set(key, { color: rgb, minRadius: radius, maxRadius: radius })
    }
  }

  return [...byColor.values()].sort((a, b) => b.maxRadius - a.maxRadius)
}

/**
 * The three parts of the stamped disc, outermost first. The count is asserted here rather
 * than left to the caller: a fourth part, or two parts sharing a colour, should fail as a
 * readable length mismatch rather than as an undefined read three lines later.
 */
function coinParts(): [Part, Part, Part] {
  const parts = meshParts(createCoin({ x: 0, y: 0 }).mesh.geometry)
  expect(parts).toHaveLength(3)
  return parts as [Part, Part, Part]
}

describe('coin mesh: one mesh, one material', () => {
  test('is a single Mesh with one Lambert material and no geometry groups', () => {
    const mesh = createCoin({ x: 0, y: 0 }).mesh

    expect(mesh).toBeInstanceOf(THREE.Mesh)
    // main.ts frees a coin with `mesh.geometry.dispose(); mesh.material.dispose()`, so child
    // meshes or a material array would leak.
    expect(mesh.children).toHaveLength(0)
    expect(Array.isArray(mesh.material)).toBe(false)
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(mesh.material.vertexColors).toBe(true)
    // Must stay white: Lambert multiplies material.color by the vertex colour, so any tint
    // here would darken the rim, the face and the stamp alike.
    expect(mesh.material.color.getHex()).toBe(0xffffff)
    // Groups would demand a material array, which a single dispose() cannot free.
    expect(mesh.geometry.groups).toHaveLength(0)
  })

  test('is double-sided, so the disc does not vanish past a quarter turn', () => {
    expect(createCoin({ x: 0, y: 0 }).mesh.material.side).toBe(THREE.DoubleSide)
  })

  test('carries a per-vertex colour attribute', () => {
    const geometry = createCoin({ x: 0, y: 0 }).mesh.geometry

    expect(geometry.type).toBe('BufferGeometry')
    const color = geometry.getAttribute('color')
    expect(color).toBeDefined()
    expect(color.itemSize).toBe(3)
    expect(color.count).toBe(geometry.getAttribute('position').count)
  })
})

describe('coin mesh: the stamp', () => {
  test('is a stamped disc, not the flat yellow circle', () => {
    const geometry = createCoin({ x: 0, y: 0 }).mesh.geometry

    expect(geometry).not.toBeInstanceOf(THREE.CircleGeometry)
    // Rim, face, stamp: the placeholder disc had exactly one colour.
    expect(meshParts(geometry)).toHaveLength(3)
  })

  test('still spans exactly one tile, centred on the origin', () => {
    const geometry = createCoin({ x: 0, y: 0 }).mesh.geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const size = box.getSize(new THREE.Vector3())

    expect(size.x).toBeCloseTo(COIN_WIDTH * TILE_SIZE, 6)
    expect(size.y).toBeCloseTo(COIN_HEIGHT * TILE_SIZE, 6)
    const center = box.getCenter(new THREE.Vector3())
    expect(center.x).toBeCloseTo(0, 6)
    expect(center.y).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(0, 6)
  })

  test('stays paper-thin, so the Y-spin still reads edge-on', () => {
    const geometry = createCoin({ x: 0, y: 0 }).mesh.geometry
    geometry.computeBoundingBox()

    // Every part is coplanar at z = 0. Depth here would mean the parts were stacked with Z
    // offsets to dodge z-fighting, which is exactly what the tiled annuli avoid.
    expect(geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBe(0)
  })

  test('nests rim outside face outside stamp, with no gap and no overlap', () => {
    const [rim, face, stamp] = coinParts()

    // Shared edges, not merely ordered radii: the parts tile the disc exactly, so no seam can
    // open and no two faces share a plane to z-fight in. Compared to 4 places because the
    // radii are hypots of float32 positions, so the shared edges agree to ~1e-6, not exactly.
    expect(rim.maxRadius).toBeCloseTo((COIN_WIDTH * TILE_SIZE) / 2, 4)
    expect(rim.minRadius).toBeCloseTo(face.maxRadius, 4)
    expect(face.minRadius).toBeCloseTo(stamp.maxRadius, 4)
    expect(stamp.minRadius).toBeCloseTo(0, 4)
  })

  test('gives each part a readable share of the disc', () => {
    const [rim, face, stamp] = coinParts()

    // A rim band and a centre mark that survive at gameplay scale: a sliver of either would
    // read as the old flat disc.
    expect(rim.maxRadius - rim.minRadius).toBeGreaterThan(rim.maxRadius * 0.1)
    expect(stamp.maxRadius).toBeGreaterThan(rim.maxRadius * 0.15)
    // The face still dominates, so the coin reads as gold rather than as a target.
    expect(face.maxRadius - face.minRadius).toBeGreaterThan(rim.maxRadius - rim.minRadius)
    expect(face.maxRadius - face.minRadius).toBeGreaterThan(stamp.maxRadius)
  })
})

describe('coin mesh: the palette', () => {
  test('keeps COIN_COLOR as the face', () => {
    const [, face] = coinParts()
    // Compared against a THREE.Color, not the raw hex: THREE.Color runs a hex through the
    // working colour space, so the stored values are not the literal in coin.ts.
    const gold = new THREE.Color(COIN_COLOR)

    expect(face.color.r).toBeCloseTo(gold.r, 6)
    expect(face.color.g).toBeCloseTo(gold.g, 6)
    expect(face.color.b).toBeCloseTo(gold.b, 6)
  })

  test('paints rim and stamp as darker golds, not arbitrary colours', () => {
    const [rim, face, stamp] = coinParts()

    for (const part of [rim, face, stamp]) {
      expect(part.color.r).toBeGreaterThan(part.color.g)
      expect(part.color.g).toBeGreaterThan(part.color.b)
    }
    // Darkest in the middle, brightest on the face: that ordering is what makes the disc read
    // as struck metal rather than as three flat rings. Ordered on lightness, not on the red
    // channel alone — a rim with less red but far more green would be the lighter colour and
    // would still slip past a red-only comparison.
    const lightness = (part: Part): number => part.color.getHSL({ h: 0, s: 0, l: 0 }).l
    expect(lightness(rim)).toBeLessThan(lightness(face))
    expect(lightness(stamp)).toBeLessThan(lightness(rim))
  })

  test('COIN_COLOR still reads as yellow: red and green high, blue low', () => {
    const r = (COIN_COLOR >> 16) & 0xff
    const g = (COIN_COLOR >> 8) & 0xff
    const b = COIN_COLOR & 0xff

    expect(r).toBeGreaterThan(0xc0)
    expect(g).toBeGreaterThan(0xc0)
    expect(b).toBeLessThan(0x40)
  })
})

describe('coin art leaves the simulation alone', () => {
  test('the hitbox is still one tile square at the spawn tile', () => {
    const coin = createCoin({ x: 5, y: 3, id: 7 })

    expect(coin.aabb).toEqual({ x: 5, y: 3, w: COIN_WIDTH, h: COIN_HEIGHT })
    expect(COIN_WIDTH).toBe(1)
    expect(COIN_HEIGHT).toBe(1)
  })

  test('the disc is still centred on the hitbox, on the Z = 0 gameplay plane', () => {
    const coin = createCoin({ x: 5, y: 3 })

    expect(coin.mesh.position.x).toBeCloseTo(5.5 * TILE_SIZE, 5)
    expect(coin.mesh.position.y).toBeCloseTo(3.5 * TILE_SIZE, 5)
    expect(coin.mesh.position.z).toBe(0)
  })

  test('collect still hides the disc exactly once', () => {
    const coin = createCoin({ x: 5, y: 3 })

    expect(coin.collect()).toBe(true)
    expect(coin.collect()).toBe(false)
    expect(coin.collected).toBe(true)
    expect(coin.mesh.visible).toBe(false)
  })

  test('the stamp still spins about Y, and only about Y', () => {
    const coin = createCoin({ x: 5, y: 3 })
    const aabb = { ...coin.aabb }
    const position = coin.mesh.position.clone()

    coin.step(0.25)

    expect(coin.mesh.rotation.y).toBeCloseTo(COIN_SPIN_SPEED * 0.25, 10)
    expect(coin.mesh.rotation.x).toBe(0)
    expect(coin.mesh.rotation.z).toBe(0)
    // The art is decoration: spinning it must never feed back into what collides.
    expect(coin.aabb).toEqual(aabb)
    expect(coin.mesh.position.equals(position)).toBe(true)
  })
})
