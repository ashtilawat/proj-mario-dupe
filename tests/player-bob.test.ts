import { describe, expect, test } from 'vitest'
import { WALK_MAX } from '../src/physics/index.ts'
import {
  BOB_AMPLITUDE,
  BOB_FADE_RATE,
  BOB_MIN_SPEED,
  BOB_STRIDE,
  PLAYER_HEIGHT,
  walkBobOffset,
} from '../src/entities/player/player.ts'

describe('the walk bob curve', () => {
  test('is exactly zero at the bottom of the cycle', () => {
    // Phase 0 is where a walk starts and where it is parked when idle, so an offset here
    // would shift the resting mesh off the hitbox centre.
    expect(walkBobOffset(0, BOB_AMPLITUDE)).toBe(0)
    expect(walkBobOffset(2 * Math.PI, BOB_AMPLITUDE)).toBeCloseTo(0, 10)
  })

  test('peaks at the amplitude halfway through the cycle', () => {
    expect(walkBobOffset(Math.PI, BOB_AMPLITUDE)).toBeCloseTo(BOB_AMPLITUDE, 10)
  })

  test('never goes negative and never overshoots the amplitude', () => {
    // Non-negative is what keeps the shoes out of the floor: the character lifts off its
    // rest pose rather than sinking below it.
    for (let i = 0; i <= 400; i += 1) {
      const offset = walkBobOffset((i / 400) * 6 * Math.PI, BOB_AMPLITUDE)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(BOB_AMPLITUDE)
    }
  })

  test('a zero amplitude is flat at every phase', () => {
    for (const phase of [0, 0.7, Math.PI, 4.2, 2 * Math.PI]) {
      expect(walkBobOffset(phase, 0)).toBe(0)
    }
  })

  test('the tuning constants stay in Mario range', () => {
    // A bob taller than the hat reads as a pogo stick, and one below a pixel reads as nothing.
    expect(BOB_AMPLITUDE).toBeGreaterThan(0.02)
    expect(BOB_AMPLITUDE).toBeLessThan(0.12)
    expect(BOB_AMPLITUDE).toBeLessThan(PLAYER_HEIGHT / 10)
    // At WALK_MAX this is ~3.75 cycles/s — a brisk stride, not a vibration.
    expect(WALK_MAX / BOB_STRIDE).toBeGreaterThan(2)
    expect(WALK_MAX / BOB_STRIDE).toBeLessThan(6)
    // A full amplitude must fade in well under a fifth of a second or a jump pops.
    expect(BOB_AMPLITUDE / BOB_FADE_RATE).toBeLessThan(0.2)
    expect(BOB_MIN_SPEED).toBeGreaterThan(0)
    expect(BOB_MIN_SPEED).toBeLessThan(WALK_MAX / 4)
  })
})
