import { describe, expect, test } from 'vitest'
import {
  AIR_ACCEL,
  AIR_DRAG,
  COYOTE_TIME_S,
  DASH_MAX,
  FIXED_DT,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER_S,
  JUMP_CUTOFF_FACTOR,
  JUMP_VELOCITY,
  STOMP_BOUNCE,
  TERMINAL_VELOCITY,
  TILE_SIZE,
  WALK_MAX,
  WALL_SLIDE_MAX_FALL,
  canCoyoteJump,
  consumeJumpBuffer,
  createCoyoteTimer,
  createJumpBuffer,
  isJumpBuffered,
  isOneWaySolid,
  moveAndCollide,
  pressJump,
  sweepAabb,
  updateCoyoteTimer,
  updateJumpBuffer,
} from '../src/physics/index.ts'
import type { Body, TileGrid, TileKind } from '../src/physics/index.ts'

interface SpyGrid extends TileGrid {
  readonly queried: Array<readonly [number, number]>
}

// Rows are written top-down for readability; tile Y is up, so row 0 is the highest ty.
// '#' solid, '=' one-way, '.' empty.
function makeGrid(rows: string[]): SpyGrid {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const queried: Array<readonly [number, number]> = []

  return {
    width,
    height,
    tileSize: TILE_SIZE,
    queried,
    getTile(tx: number, ty: number): TileKind {
      queried.push([tx, ty])
      const row = rows[height - 1 - ty]
      const char = row?.[tx]
      if (char === '#') return 'solid'
      if (char === '=') return 'oneWay'
      return 'empty'
    },
  }
}

function emptyGrid(width: number, height: number): SpyGrid {
  return makeGrid(Array.from({ length: height }, () => '.'.repeat(width)))
}

function body(x: number, y: number, w: number, h: number, vx: number, vy: number): Body {
  return { aabb: { x, y, w, h }, velocity: { x: vx, y: vy } }
}

describe('sweepAabb', () => {
  test('sweeping into a solid wall from the left stops flush against it', () => {
    const grid = makeGrid(['.#.'])
    const result = sweepAabb({ x: 0, y: 0, w: 0.5, h: 0.5 }, 1, 0, grid)

    expect(result.hitX).toBe(true)
    expect(result.x).toBeCloseTo(0.5, 10)
    // Flush contact, never overlapping the tile at [1, 2].
    expect(result.x + 0.5).toBeLessThanOrEqual(1)
  })

  test('sweeping into a floor from above lands on top of it', () => {
    const grid = makeGrid(['....', '....', '####'])
    const result = sweepAabb({ x: 1, y: 2, w: 0.5, h: 0.5 }, 0, -1.2, grid)

    expect(result.hitY).toBe(true)
    expect(result.grounded).toBe(true)
    expect(result.y).toBeCloseTo(1, 10)
  })

  test('free movement through empty space consumes the whole delta', () => {
    const grid = emptyGrid(8, 8)
    const result = sweepAabb({ x: 1, y: 4, w: 0.5, h: 0.5 }, 0.75, -0.5, grid)

    expect(result.hitX).toBe(false)
    expect(result.hitY).toBe(false)
    expect(result.grounded).toBe(false)
    expect(result.x).toBeCloseTo(1.75, 10)
    expect(result.y).toBeCloseTo(3.5, 10)
  })

  test('only queries tiles overlapping the swept AABB, not the whole map', () => {
    const grid = emptyGrid(64, 64)
    sweepAabb({ x: 1, y: 1, w: 0.5, h: 0.5 }, 0.25, 0, grid)

    expect(grid.queried.length).toBeGreaterThan(0)
    expect(grid.queried).not.toContainEqual([63, 63])
    for (const [tx, ty] of grid.queried) {
      expect(tx).toBe(1)
      expect(ty).toBe(1)
    }
  })
})

describe('X-then-Y resolution', () => {
  test('sliding down a 3-tile-high wall does not snag on the horizontal tile seams', () => {
    const grid = makeGrid(['...#', '...#', '...#'])
    // Bottom sits exactly on the y = 2 seam between two wall tiles, pressed into the wall.
    const falling = body(2.19, 2, 0.8, 0.8, 3, -6)
    const result = moveAndCollide(falling, 1 / 60, grid)

    expect(result.hitX).toBe(true)
    expect(result.x).toBeCloseTo(2.2, 10)
    expect(result.hitY).toBe(false)
    expect(result.grounded).toBe(false)
    expect(result.y).toBeCloseTo(1.9, 10)
    expect(falling.velocity.x).toBe(0)
    expect(falling.velocity.y).toBe(-6)
  })
})

describe('moveAndCollide', () => {
  test('applies velocity over dt and zeroes the velocity on the axis that hit', () => {
    const grid = makeGrid(['....', '....', '####'])
    const falling = body(1, 2, 0.5, 0.5, 0, -60)
    const result = moveAndCollide(falling, 1 / 60, grid)

    expect(result.grounded).toBe(true)
    expect(falling.aabb.y).toBeCloseTo(1, 10)
    expect(falling.velocity.y).toBe(0)
  })
})

describe('isOneWaySolid', () => {
  test('is solid only when moving down from above the platform top', () => {
    expect(isOneWaySolid(-1, 2, 2)).toBe(true)
    expect(isOneWaySolid(1, 2, 2)).toBe(false)
    expect(isOneWaySolid(-1, 1.5, 2)).toBe(false)
  })
})

describe('one-way platforms', () => {
  const platform = () => makeGrid(['....', '====', '....'])

  test('falling onto one from above lands on top', () => {
    const result = sweepAabb({ x: 1, y: 2.5, w: 0.5, h: 0.5 }, 0, -1, platform())

    expect(result.hitY).toBe(true)
    expect(result.grounded).toBe(true)
    expect(result.y).toBeCloseTo(2, 10)
  })

  test('jumping up through one passes through', () => {
    const result = sweepAabb({ x: 1, y: 0.5, w: 0.5, h: 0.5 }, 0, 1, platform())

    expect(result.hitY).toBe(false)
    expect(result.y).toBeCloseTo(1.5, 10)
  })

  test('starting overlapped and moving down does not snap up to the platform top', () => {
    const result = sweepAabb({ x: 1, y: 1.5, w: 0.5, h: 0.5 }, 0, -0.6, platform())

    expect(result.hitY).toBe(false)
    expect(result.y).toBeCloseTo(0.9, 10)
  })

  test('never blocks horizontal movement', () => {
    const result = sweepAabb({ x: 0.1, y: 1, w: 0.5, h: 0.5 }, 1, 0, platform())

    expect(result.hitX).toBe(false)
    expect(result.x).toBeCloseTo(1.1, 10)
  })
})

describe('coyote time', () => {
  test('stays jumpable for 100ms after leaving the ground, then expires', () => {
    const timer = createCoyoteTimer()

    updateCoyoteTimer(timer, true, FIXED_DT)
    expect(canCoyoteJump(timer)).toBe(true)

    // The first airborne update is the step off the ledge itself, which opens the window
    // rather than spending it — see the T-015 tests in coyote-window.test.ts.
    updateCoyoteTimer(timer, false, FIXED_DT)
    expect(canCoyoteJump(timer)).toBe(true)

    updateCoyoteTimer(timer, false, 0.1)
    expect(canCoyoteJump(timer)).toBe(true)

    updateCoyoteTimer(timer, false, 0.001)
    expect(canCoyoteJump(timer)).toBe(false)
  })

  test('touching the ground again re-arms it', () => {
    const timer = createCoyoteTimer()

    updateCoyoteTimer(timer, false, 1)
    expect(canCoyoteJump(timer)).toBe(false)

    updateCoyoteTimer(timer, true, FIXED_DT)
    expect(canCoyoteJump(timer)).toBe(true)
  })
})

describe('jump buffer', () => {
  test('a press 120ms before landing is still armed on landing', () => {
    const buffer = createJumpBuffer()
    pressJump(buffer)
    updateJumpBuffer(buffer, 0.12)

    expect(isJumpBuffered(buffer)).toBe(true)
  })

  test('a press 121ms before landing has expired', () => {
    const buffer = createJumpBuffer()
    pressJump(buffer)
    updateJumpBuffer(buffer, 0.121)

    expect(isJumpBuffered(buffer)).toBe(false)
  })

  test('consuming an armed buffer disarms it', () => {
    const buffer = createJumpBuffer()
    pressJump(buffer)

    expect(consumeJumpBuffer(buffer)).toBe(true)
    expect(isJumpBuffered(buffer)).toBe(false)
    expect(consumeJumpBuffer(buffer)).toBe(false)
  })

  test('starts unarmed', () => {
    expect(isJumpBuffered(createJumpBuffer())).toBe(false)
  })
})

describe('tuning constants', () => {
  test('gravity is 60 tiles/s^2 and jump velocity is 23 tiles/s', () => {
    expect(GRAVITY).toBe(60)
    expect(JUMP_VELOCITY).toBe(23)
  })

  test('coyote and jump-buffer windows are 100ms and 120ms', () => {
    expect(COYOTE_TIME_S).toBeCloseTo(0.1, 10)
    expect(JUMP_BUFFER_S).toBeCloseTo(0.12, 10)
  })

  test('exposes the remaining PRD 4.2 starting values', () => {
    expect(TILE_SIZE).toBe(16)
    expect(FIXED_DT).toBeCloseTo(1 / 120, 12)
    expect(JUMP_CUTOFF_FACTOR).toBe(0.25)
    expect(WALK_MAX).toBe(6)
    expect(DASH_MAX).toBe(9.6)
    expect(GROUND_ACCEL).toBe(30)
    expect(GROUND_FRICTION).toBe(40)
    expect(AIR_ACCEL).toBe(18)
    expect(AIR_DRAG).toBe(4)
    expect(TERMINAL_VELOCITY).toBe(26)
    expect(STOMP_BOUNCE).toBe(15)
    expect(WALL_SLIDE_MAX_FALL).toBe(6)
  })
})
