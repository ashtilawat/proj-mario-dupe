import { COYOTE_TIME_S, JUMP_BUFFER_S } from './constants.ts'

/** Tracks how long ago the body was last grounded. */
export interface CoyoteTimer {
  timeSinceGrounded: number
  /** Grounded flag from the previous update, used to spot the step off the ledge. */
  wasGrounded: boolean
}

/** Tracks how long ago the jump button was last pressed. */
export interface JumpBuffer {
  timeSincePressed: number
}

export function createCoyoteTimer(): CoyoteTimer {
  return { timeSinceGrounded: Number.POSITIVE_INFINITY, wasGrounded: false }
}

/**
 * Call once per step with the grounded flag from moveAndCollide.
 *
 * The step that carries the body off a ledge is deliberately not billed a `dt`: callers
 * check the timer at the top of a step but update it at the bottom, so at the moment of
 * that step's check the body was still standing on the ledge. Charging it anyway spends a
 * tick of grace before the player has had a single chance to use it, closing the window one
 * step early — at 120 Hz that is 8.3 ms of a 100 ms window, so a press at a true 100 ms
 * reads as 108.3 ms and is refused.
 *
 * Skipping the charge rather than zeroing the timer is what keeps a spent grace spent: when
 * a caller cashes the window in for a jump it parks the timer past the window itself, on the
 * same step the sweep first reports airborne. Leaving that value untouched means this never
 * has to know which sentinel the caller picked, and a ledge jump cannot re-arm itself into a
 * free second jump in mid-air.
 */
export function updateCoyoteTimer(timer: CoyoteTimer, grounded: boolean, dt: number): void {
  if (grounded) {
    timer.timeSinceGrounded = 0
  } else if (!timer.wasGrounded) {
    timer.timeSinceGrounded += dt
  }
  timer.wasGrounded = grounded
}

/** True while grounded or still inside the coyote window after leaving the ground. */
export function canCoyoteJump(timer: CoyoteTimer, window: number = COYOTE_TIME_S): boolean {
  return timer.timeSinceGrounded <= window
}

export function createJumpBuffer(): JumpBuffer {
  return { timeSincePressed: Number.POSITIVE_INFINITY }
}

/** Call when the jump button goes down, whether or not a jump is possible yet. */
export function pressJump(buffer: JumpBuffer): void {
  buffer.timeSincePressed = 0
}

/** Call once per step. */
export function updateJumpBuffer(buffer: JumpBuffer, dt: number): void {
  buffer.timeSincePressed += dt
}

/** True while a press is still armed inside the buffer window. */
export function isJumpBuffered(buffer: JumpBuffer, window: number = JUMP_BUFFER_S): boolean {
  return buffer.timeSincePressed <= window
}

/** Spend an armed press. Returns false (and changes nothing) if none is armed. */
export function consumeJumpBuffer(buffer: JumpBuffer, window: number = JUMP_BUFFER_S): boolean {
  if (!isJumpBuffered(buffer, window)) return false
  buffer.timeSincePressed = Number.POSITIVE_INFINITY
  return true
}
