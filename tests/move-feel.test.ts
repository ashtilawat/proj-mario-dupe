import { describe, expect, test } from 'vitest'
import { DASH_MAX, FIXED_DT, TILE_SIZE, WALK_MAX } from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import { createDashInput, createPlayer } from '../src/entities/player/index.ts'
import type { InputState } from '../src/engine/input.ts'
import type { Player, PlayerInput } from '../src/entities/player/index.ts'

// Rows are written top-down for readability; tile Y is up, so row 0 is the highest ty.
// '#' solid, '.' empty.
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

/** Flat floor one tile deep, so the floor top is y = 1. */
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

/** One step is enough to resolve a player spawned flush on the floor into grounded state. */
function settle(player: Player): Player {
  stepFor(player, 2)
  return player
}

function onGround(x = 2): Player {
  return settle(createPlayer({ x, y: 1, grid: flatGround(64, 8) }))
}

/**
 * Puts a player on flat ground, then steps at FIXED_DT holding jump for the first
 * `holdFrames` steps and releasing after that, tracking the highest aabb.y reached
 * above the resting y. Returns that peak, in tiles. Stops once the player is grounded
 * again after having left the ground; caps the loop and throws if it never lands.
 */
function peakHeight(holdFrames: number): number {
  const player = onGround()
  const restingY = player.body.aabb.y
  let peak = 0
  let hasLeftGround = false

  for (let i = 0; i < 600; i += 1) {
    player.step(FIXED_DT, input({ jump: i < holdFrames }))
    const height = player.body.aabb.y - restingY
    if (height > peak) peak = height
    if (!player.grounded) hasLeftGround = true
    if (hasLeftGround && player.grounded) return peak
  }

  throw new Error('player never landed within the frame cap')
}

/** Jump held for the entire rise: the full-hold reference peak. */
function fullHoldPeak(): number {
  return peakHeight(Number.POSITIVE_INFINITY)
}

describe('tap jump', () => {
  test('a 6-frame (50 ms) tap peaks below 30% of a full hold', () => {
    const fullHold = fullHoldPeak()

    expect(peakHeight(6)).toBeLessThan(0.3 * fullHold)
  })

  test('a 10-frame (83 ms) tap peaks below 45% of a full hold', () => {
    const fullHold = fullHoldPeak()

    expect(peakHeight(10)).toBeLessThan(0.45 * fullHold)
  })

  test('a 50 ms tap still clears a one-tile ledge', () => {
    expect(peakHeight(6)).toBeGreaterThanOrEqual(1.0)
  })
})

describe('dash from Shift', () => {
  function engineState(partial: Partial<InputState> = {}): InputState {
    return { left: false, right: false, up: false, down: false, jump: false, moveX: 0, ...partial }
  }

  test('DASH_MAX is 1.6 times WALK_MAX', () => {
    expect(DASH_MAX / WALK_MAX).toBeCloseTo(1.6, 10)
  })

  test('holding Shift reaches 1.6x WALK_MAX through createDashInput', () => {
    const dash = createDashInput()
    const target = new EventTarget()
    dash.attach(target)
    target.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }))

    const player = onGround()
    const held = dash.poll(engineState({ right: true, moveX: 1 }))
    expect(held.dash).toBe(true)

    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, dash.poll(engineState({ right: true, moveX: 1 })))
    }

    expect(player.body.velocity.x).toBeGreaterThan(WALK_MAX)
    expect(player.body.velocity.x).toBeCloseTo(1.6 * WALK_MAX, 10)
    expect(player.body.velocity.x).toBeCloseTo(DASH_MAX, 10)
  })

  test('without Shift the same path settles at WALK_MAX', () => {
    const dash = createDashInput()
    const player = onGround()

    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, dash.poll(engineState({ right: true, moveX: 1 })))
    }

    expect(dash.poll(engineState({ right: true, moveX: 1 })).dash).toBe(false)
    expect(player.body.velocity.x).toBeCloseTo(WALK_MAX, 10)
  })
})
