import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { COIN_COLOR, COIN_HEIGHT, COIN_SPIN_SPEED, COIN_WIDTH, createCoin } from './coin.ts'
import { overlaps, TILE_SIZE } from '../../physics/index.ts'
import type { Aabb } from '../../physics/index.ts'

describe('createCoin', () => {
  test('places the hitbox at the spawn tile, one tile square', () => {
    const coin = createCoin({ x: 5, y: 3, id: 7 })
    expect(coin.aabb).toEqual({ x: 5, y: 3, w: COIN_WIDTH, h: COIN_HEIGHT })
  })

  test('is one tile square, so it lines up with the tile grid', () => {
    expect(COIN_WIDTH).toBe(1)
    expect(COIN_HEIGHT).toBe(1)
  })

  test('starts uncollected', () => {
    expect(createCoin({ x: 0, y: 0 }).collected).toBe(false)
  })

  test('takes the spawn id, defaulting to 0 like the walker', () => {
    expect(createCoin({ x: 1, y: 2, id: 42 }).id).toBe(42)
    expect(createCoin({ x: 1, y: 2 }).id).toBe(0)
  })
})

/** Radial extents of one flat-coloured part of the merged disc, keyed by its vertex colour. */
function partRadii(geometry: THREE.BufferGeometry): Map<string, { min: number; max: number }> {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  const byColor = new Map<string, { min: number; max: number }>()

  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i))
    const key = [color.getX(i), color.getY(i), color.getZ(i)].join(',')
    const part = byColor.get(key)
    if (part) {
      part.min = Math.min(part.min, radius)
      part.max = Math.max(part.max, radius)
    } else {
      byColor.set(key, { min: radius, max: radius })
    }
  }

  return byColor
}

describe('coin mesh', () => {
  test('is a disc exactly one tile across, in world units', () => {
    const geometry = createCoin({ x: 0, y: 0 }).mesh.geometry
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())

    // Measured off the silhouette rather than a primitive's radius parameter: the disc is
    // merged from three parts now, so there is no single `parameters.radius` to read.
    expect(size.x).toBeCloseTo(TILE_SIZE, 5)
    expect(size.y).toBeCloseTo(TILE_SIZE, 5)
    // Coplanar parts, so the spinning disc still goes edge-on rather than showing a slab.
    expect(size.z).toBe(0)
  })

  test('is a stamped disc: rim, face and stamp, nested and vertex-coloured', () => {
    const geometry = createCoin({ x: 0, y: 0 }).mesh.geometry
    const parts = [...partRadii(geometry).values()].sort((a, b) => b.max - a.max)

    // Asserted before the destructure, so a fourth part or two parts sharing a colour fails
    // as a length mismatch rather than as an undefined read below.
    expect(parts).toHaveLength(3)
    const [rim, face, stamp] = parts as [
      { min: number; max: number },
      { min: number; max: number },
      { min: number; max: number },
    ]

    // The parts tile the disc exactly: each one's inner edge is the next one's outer edge.
    // Four places, not more: these radii are hypots of float32 positions.
    expect(rim.max).toBeCloseTo(TILE_SIZE / 2, 4)
    expect(rim.min).toBeCloseTo(face.max, 4)
    expect(face.min).toBeCloseTo(stamp.max, 4)
    expect(stamp.min).toBeCloseTo(0, 4)
  })

  test('is one Mesh drawn by one vertex-coloured Lambert material', () => {
    const mesh = createCoin({ x: 0, y: 0 }).mesh

    // main.ts frees a coin with `mesh.geometry.dispose(); mesh.material.dispose()`.
    expect(mesh.children).toHaveLength(0)
    expect(Array.isArray(mesh.material)).toBe(false)
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(mesh.material.vertexColors).toBe(true)
    expect(mesh.geometry.groups).toHaveLength(0)
  })

  test('leaves the material white, so COIN_COLOR reaches the face untinted', () => {
    // Lambert multiplies material.color by the vertex colour; COIN_COLOR now lives in the
    // face's vertex colours, asserted in tests/coin-stamp.test.ts.
    expect(createCoin({ x: 0, y: 0 }).mesh.material.color.getHex()).toBe(0xffffff)
  })

  test('COIN_COLOR reads as yellow: red and green high, blue low', () => {
    const r = (COIN_COLOR >> 16) & 0xff
    const g = (COIN_COLOR >> 8) & 0xff
    const b = COIN_COLOR & 0xff
    expect(r).toBeGreaterThan(0xc0)
    expect(g).toBeGreaterThan(0xc0)
    expect(b).toBeLessThan(0x40)
  })

  test('sits centred on the hitbox, on the Z = 0 gameplay plane', () => {
    const coin = createCoin({ x: 5, y: 3 })
    expect(coin.mesh.position.x).toBeCloseTo(5.5 * TILE_SIZE, 5)
    expect(coin.mesh.position.y).toBeCloseTo(3.5 * TILE_SIZE, 5)
    expect(coin.mesh.position.z).toBe(0)
  })

  test('starts visible', () => {
    expect(createCoin({ x: 0, y: 0 }).mesh.visible).toBe(true)
  })
})

/** A player-sized box parked squarely on the coin at tile (5, 3). */
const PLAYER_ON_COIN: Aabb = { x: 5.2, y: 3.1, w: 1, h: 1 }
/** Three tiles clear of it. */
const PLAYER_CLEAR: Aabb = { x: 8, y: 3, w: 1, h: 1 }

describe('collect', () => {
  test('hides the disc and reports the collection', () => {
    const coin = createCoin({ x: 5, y: 3 })
    expect(coin.collect()).toBe(true)
    expect(coin.collected).toBe(true)
    expect(coin.mesh.visible).toBe(false)
  })

  test('is idempotent: later calls change nothing and report false', () => {
    const coin = createCoin({ x: 5, y: 3 })
    coin.collect()
    expect(coin.collect()).toBe(false)
    expect(coin.collect()).toBe(false)
    expect(coin.collected).toBe(true)
    expect(coin.mesh.visible).toBe(false)
  })

  test('a sustained overlap collects exactly once', () => {
    // Stands in for the wiring ticket's per-frame loop: the player parks on the coin, the
    // overlap check runs every frame, but only one frame may score.
    const coin = createCoin({ x: 5, y: 3 })
    let collections = 0
    for (let frame = 0; frame < 10; frame += 1) {
      if (overlaps(PLAYER_ON_COIN, coin.aabb) && coin.collect()) collections += 1
    }
    expect(collections).toBe(1)
    expect(coin.mesh.visible).toBe(false)
  })

  test('leaves a coin the player never touches alone', () => {
    const coin = createCoin({ x: 5, y: 3 })
    for (let frame = 0; frame < 10; frame += 1) {
      if (overlaps(PLAYER_CLEAR, coin.aabb)) coin.collect()
    }
    expect(coin.collected).toBe(false)
    expect(coin.mesh.visible).toBe(true)
  })
})

/** One full turn, in radians. */
const TWO_PI = Math.PI * 2

describe('coin spin', () => {
  test('spins one full revolution per second', () => {
    expect(COIN_SPIN_SPEED).toBeCloseTo(TWO_PI, 10)
  })

  test('starts unrotated', () => {
    const coin = createCoin({ x: 0, y: 0 })
    expect(coin.mesh.rotation.y).toBe(0)
  })

  test('advances the angle by SPEED * dt', () => {
    const coin = createCoin({ x: 0, y: 0 })
    coin.step(0.25)
    expect(coin.mesh.rotation.y).toBeCloseTo(COIN_SPIN_SPEED * 0.25, 10)
  })

  test('accumulates across steps', () => {
    const coin = createCoin({ x: 0, y: 0 })
    coin.step(0.1)
    coin.step(0.1)
    expect(coin.mesh.rotation.y).toBeCloseTo(COIN_SPIN_SPEED * 0.2, 10)
  })

  test('spins about Y only, so the disc never tumbles', () => {
    const coin = createCoin({ x: 0, y: 0 })
    for (let frame = 0; frame < 30; frame += 1) coin.step(1 / 60)
    // Half a second at one revolution per second: the disc really has turned, so the
    // untouched-axis assertions below cannot pass by way of a step() that does nothing.
    expect(coin.mesh.rotation.y).toBeCloseTo(Math.PI, 10)
    expect(coin.mesh.rotation.x).toBe(0)
    expect(coin.mesh.rotation.z).toBe(0)
  })

  test('wraps, so the angle stays inside [0, 2pi)', () => {
    const coin = createCoin({ x: 0, y: 0 })
    for (let frame = 0; frame < 600; frame += 1) {
      coin.step(1 / 60)
      expect(coin.mesh.rotation.y).toBeGreaterThanOrEqual(0)
      expect(coin.mesh.rotation.y).toBeLessThan(TWO_PI)
    }
  })

  test('is double-sided, so the disc does not vanish past a quarter turn', () => {
    expect(createCoin({ x: 0, y: 0 }).mesh.material.side).toBe(THREE.DoubleSide)
  })

  test('leaves the hitbox and the mesh position alone', () => {
    const coin = createCoin({ x: 5, y: 3 })
    const aabb = { ...coin.aabb }
    const position = coin.mesh.position.clone()
    for (let frame = 0; frame < 600; frame += 1) coin.step(1 / 60)
    expect(coin.aabb).toEqual(aabb)
    expect(coin.mesh.position.equals(position)).toBe(true)
    // The overlap answers a spinning coin gives must be the ones it gave at rest.
    expect(overlaps(PLAYER_ON_COIN, coin.aabb)).toBe(true)
    expect(overlaps(PLAYER_CLEAR, coin.aabb)).toBe(false)
  })

  test('freezes once collected', () => {
    const coin = createCoin({ x: 0, y: 0 })
    coin.step(0.1)
    const frozen = coin.mesh.rotation.y
    coin.collect()
    for (let frame = 0; frame < 10; frame += 1) coin.step(0.1)
    expect(coin.mesh.rotation.y).toBe(frozen)
  })

  test('spinning neither collects the coin nor hides it', () => {
    const coin = createCoin({ x: 5, y: 3 })
    for (let frame = 0; frame < 60; frame += 1) coin.step(1 / 60)
    expect(coin.collected).toBe(false)
    expect(coin.mesh.visible).toBe(true)
  })

  test('collect stays idempotent after a long spin', () => {
    const coin = createCoin({ x: 5, y: 3 })
    for (let frame = 0; frame < 60; frame += 1) coin.step(1 / 60)
    expect(coin.collect()).toBe(true)
    expect(coin.collect()).toBe(false)
    expect(coin.collected).toBe(true)
    expect(coin.mesh.visible).toBe(false)
  })
})
