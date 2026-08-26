import { COYOTE_TIME_S, JUMP_BUFFER_S } from './constants.ts'

/** Tracks how long ago the body was last grounded. */
export interface CoyoteTimer {
  timeSinceGrounded: number
}

/** Tracks how long ago the jump button was last pressed. */
export interface JumpBuffer {
  timeSincePressed: number
}

export function createCoyoteTimer(): CoyoteTimer {
  return { timeSinceGrounded: Number.POSITIVE_INFINITY }
}

/** Call once per step with the grounded flag from moveAndCollide. */
export function updateCoyoteTimer(timer: CoyoteTimer, grounded: boolean, dt: number): void {
  timer.timeSinceGrounded = grounded ? 0 : timer.timeSinceGrounded + dt
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
