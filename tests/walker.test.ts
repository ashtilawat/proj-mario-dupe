import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { STOMP_BOUNCE, TILE_SIZE } from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import * as walkerModule from '../src/entities/enemies/walker.ts'
import { createWalker } from '../src/entities/enemies/walker.ts'

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

describe('gray-box mesh', () => {
  test('is a gray THREE box mesh on the gameplay plane, synced from the hitbox', () => {
    const walker = createWalker({ x: 5, y: 1, dir: 1 })

    expect(walker.mesh).toBeInstanceOf(THREE.Mesh)
    expect(walker.mesh.geometry.type).toBe('BoxGeometry')
    expect(walker.mesh.material).not.toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(walker.mesh.position.z).toBe(0)

    // World units: TILE_SIZE per tile, mesh centred on the AABB.
    expect(walker.mesh.position.x).toBeCloseTo((5 + walker.aabb.w / 2) * TILE_SIZE, 6)
    expect(walker.mesh.position.y).toBeCloseTo((1 + walker.aabb.h / 2) * TILE_SIZE, 6)

    for (let i = 0; i < 60; i += 1) walker.step(DT, LONG_FLOOR)

    expect(walker.mesh.position.x).toBeCloseTo((walker.aabb.x + walker.aabb.w / 2) * TILE_SIZE, 6)
    expect(walker.mesh.position.y).toBeCloseTo((walker.aabb.y + walker.aabb.h / 2) * TILE_SIZE, 6)
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
