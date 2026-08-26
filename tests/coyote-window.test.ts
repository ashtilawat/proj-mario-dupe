import { describe, expect, test } from 'vitest'
import {
  COYOTE_TIME_S,
  FIXED_DT,
  JUMP_VELOCITY,
  TILE_SIZE,
  canCoyoteJump,
  createCoyoteTimer,
  updateCoyoteTimer,
} from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import { createPlayer } from '../src/entities/player/index.ts'
import type { Player, PlayerInput } from '../src/entities/player/index.ts'

// T-015. COYOTE_TIME_S is 100 ms and FIXED_DT is 1/120 s, so the window is exactly
// 12 fixed steps wide. These tests pin the whole window at 120 Hz through the real
// check-then-update order player.step uses, which is what the looser existing tests
// (50 ms jumps / 150 ms does not, plus a single 0.1 s dump into updateCoyoteTimer) miss.
const WINDOW_FRAMES = Math.round(COYOTE_TIME_S / FIXED_DT)

// Rows are written top-down for readability; tile Y is up, so row 0 is the highest ty.
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

function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { jump: false, dash: false, moveX: 0, ...partial }
}

const NEUTRAL = input()
const RUN_RIGHT = input({ moveX: 1, right: true })

/**
 * Runs right off a floor that ends at x = 4 and returns the frame the sweep first
 * reports airborne — i.e. the step that carried the body off the ledge has just run,
 * so zero *airborne* steps have elapsed and the coyote window has just opened.
 */
function walkOffLedge(): Player {
  const grid = makeGrid([
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '####........',
  ])
  const player = createPlayer({ x: 1, y: 1, grid })
  player.step(FIXED_DT, NEUTRAL) // settle onto the floor
  for (let i = 0; i < 600 && player.grounded; i += 1) player.step(FIXED_DT, RUN_RIGHT)
  expect(player.grounded).toBe(false)
  return player
}

/** Waits `frames` airborne steps after the ledge, then presses jump on the next step. */
function pressJumpAfter(frames: number): Player {
  const player = walkOffLedge()
  for (let i = 0; i < frames; i += 1) player.step(FIXED_DT, NEUTRAL)
  player.step(FIXED_DT, input({ jump: true }))
  return player
}

describe('coyote window at 120 Hz (T-015)', () => {
  test('the step that carries the body off the ledge does not spend any of the window', () => {
    const player = walkOffLedge()

    expect(player.coyote.timeSinceGrounded).toBe(0)
  })

  test('a press a full COYOTE_TIME_S after leaving the ledge still launches', () => {
    const player = pressJumpAfter(WINDOW_FRAMES)

    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY, 10)
    expect(canCoyoteJump(player.coyote)).toBe(false) // the grace was spent, not left open
  })

  test('a press one step past COYOTE_TIME_S does not launch', () => {
    const player = pressJumpAfter(WINDOW_FRAMES + 1)

    expect(player.body.velocity.y).toBeLessThan(0)
  })

  test('every step of the window launches, and nothing past it does', () => {
    const launched: boolean[] = []
    for (let frames = 0; frames <= WINDOW_FRAMES + 6; frames += 1) {
      launched.push(pressJumpAfter(frames).body.velocity.y > 0)
    }

    const expected = launched.map((_, frames) => frames <= WINDOW_FRAMES)
    expect(launched).toEqual(expected)
  })

  test('the acceptance case: 100 ms jumps, 150 ms does not', () => {
    expect(pressJumpAfter(Math.round(0.1 / FIXED_DT)).body.velocity.y).toBeGreaterThan(0)
    expect(pressJumpAfter(Math.round(0.15 / FIXED_DT)).body.velocity.y).toBeLessThan(0)
  })
})

describe('coyote window bookkeeping (T-015)', () => {
  test('leaving the ground opens the window at zero rather than at one step', () => {
    const timer = createCoyoteTimer()
    updateCoyoteTimer(timer, true, FIXED_DT)

    updateCoyoteTimer(timer, false, FIXED_DT)

    expect(timer.timeSinceGrounded).toBe(0)
  })

  test('the window survives exactly COYOTE_TIME_S of airborne steps', () => {
    const timer = createCoyoteTimer()
    updateCoyoteTimer(timer, true, FIXED_DT)
    updateCoyoteTimer(timer, false, FIXED_DT) // the step off the ledge

    // The window is inclusive: a press at exactly COYOTE_TIME_S still counts, so every
    // check from 0 up to and including WINDOW_FRAMES airborne steps must pass.
    for (let i = 0; i <= WINDOW_FRAMES; i += 1) {
      expect(canCoyoteJump(timer)).toBe(true)
      updateCoyoteTimer(timer, false, FIXED_DT)
    }

    expect(canCoyoteJump(timer)).toBe(false)
  })

  test('a coyote jump spent on the ledge step does not re-arm the window', () => {
    const timer = createCoyoteTimer()
    updateCoyoteTimer(timer, true, FIXED_DT)
    // player.step spends the grace by parking the timer at infinity, then updates it
    // with the sweep that just carried the body into the air.
    timer.timeSinceGrounded = Number.POSITIVE_INFINITY

    updateCoyoteTimer(timer, false, FIXED_DT)

    expect(canCoyoteJump(timer)).toBe(false)
  })

  test('any spent-grace sentinel survives the ledge step, not just infinity', () => {
    // The caller owns the sentinel it parks the timer at; timers.ts must not depend on
    // which one. Anything past the window means spent, and spending must outlive the
    // step off the ledge or a ledge jump hands out a free second jump in mid-air.
    const timer = createCoyoteTimer()
    updateCoyoteTimer(timer, true, FIXED_DT)
    timer.timeSinceGrounded = COYOTE_TIME_S + 1

    updateCoyoteTimer(timer, false, FIXED_DT)

    expect(canCoyoteJump(timer)).toBe(false)
  })

  test('a spent window re-arms only after touching the ground again', () => {
    const timer = createCoyoteTimer()
    updateCoyoteTimer(timer, true, FIXED_DT)
    timer.timeSinceGrounded = Number.POSITIVE_INFINITY
    updateCoyoteTimer(timer, false, FIXED_DT)
    updateCoyoteTimer(timer, false, FIXED_DT)
    expect(canCoyoteJump(timer)).toBe(false)

    updateCoyoteTimer(timer, true, FIXED_DT)

    expect(canCoyoteJump(timer)).toBe(true)
  })

  test('jumping straight off the ledge does not hand out a second jump in the air', () => {
    const player = walkOffLedge()
    player.step(FIXED_DT, input({ jump: true }))
    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY, 10)

    // Release and re-press while still rising and still inside the old window.
    player.step(FIXED_DT, NEUTRAL)
    const rising = player.body.velocity.y
    player.step(FIXED_DT, input({ jump: true }))

    expect(player.body.velocity.y).toBeLessThan(rising)
  })
})
