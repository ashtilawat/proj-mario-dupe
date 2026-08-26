import {
  AIR_ACCEL,
  AIR_DRAG,
  DASH_MAX,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_CUTOFF_FACTOR,
  JUMP_VELOCITY,
  TERMINAL_VELOCITY,
  WALK_MAX,
  canCoyoteJump,
  consumeJumpBuffer,
  createCoyoteTimer,
  createJumpBuffer,
  moveAndCollide,
  pressJump,
  updateCoyoteTimer,
  updateJumpBuffer,
} from '../../physics/index.ts'
import type { Body, SweepResult } from '../../physics/index.ts'
import { GAMEPLAY_Z, createPlayerCapsule } from '../../render/index.ts'
import type { Player, PlayerInput, PlayerOptions } from './types.ts'

// The hitbox matches the render capsule's silhouette (radius 0.35, length 0.8), but it is
// a plain AABB in tile space: the mesh never takes part in collision.
/** Hitbox width in tiles. */
export const PLAYER_WIDTH = 0.7
/** Hitbox height in tiles. */
export const PLAYER_HEIGHT = 1.5

/** Facing yaw for +X. */
export const FACE_RIGHT = 0
/** Facing yaw for -X. Turning is a Y-axis rotation, never a sprite flip. */
export const FACE_LEFT = Math.PI
/** Exponential smoothing rate for the turn, per second. */
export const TURN_RATE = 18

/** Steps `current` towards `target` without overshooting it. */
function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

/** Analog stick wins when pushed; otherwise the digital pair decides. */
function horizontalIntent(input: PlayerInput): number {
  if (input.moveX !== 0) return input.moveX
  return (input.right === true ? 1 : 0) - (input.left === true ? 1 : 0)
}

export function createPlayer(options: PlayerOptions): Player {
  const { grid } = options
  const body: Body = {
    aabb: { x: options.x, y: options.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT },
    velocity: { x: 0, y: 0 },
  }
  const mesh = options.mesh ?? createPlayerCapsule()
  const coyote = createCoyoteTimer()
  const jumpBuffer = createJumpBuffer()
  // Reused every step so a 120 Hz sim allocates nothing.
  const sweep: SweepResult = { x: 0, y: 0, hitX: false, hitY: false, grounded: false }

  let prevJump = false
  let targetYaw = FACE_RIGHT

  function step(dt: number, input: PlayerInput): void {
    // 1. Arm the buffer on the rising edge, so a tap counts even if nothing can act on it yet.
    if (input.jump && !prevJump) pressJump(jumpBuffer)
    updateJumpBuffer(jumpBuffer, dt)

    // 2. Gravity. The sweep never applies it — forces belong to the controller.
    const velocity = body.velocity
    velocity.y = Math.max(velocity.y - GRAVITY * dt, -TERMINAL_VELOCITY)

    // 3. Horizontal. Overspeed (a released dash) bleeds off at the friction rate.
    const intent = horizontalIntent(input)
    const maxSpeed = input.dash ? DASH_MAX : WALK_MAX
    const accel = player.grounded ? GROUND_ACCEL : AIR_ACCEL
    const friction = player.grounded ? GROUND_FRICTION : AIR_DRAG
    if (intent === 0) {
      velocity.x = moveToward(velocity.x, 0, friction * dt)
    } else {
      const target = intent * maxSpeed
      const rate = velocity.x * intent > maxSpeed ? friction : accel
      velocity.x = moveToward(velocity.x, target, rate * dt)
    }

    if (canCoyoteJump(coyote) && consumeJumpBuffer(jumpBuffer)) {
      // 4. Jump. Coyote grace and the buffered press are both spent here; without spending
      // the ground contact the still-open coyote window would hand out a second jump.
      velocity.y = JUMP_VELOCITY
      coyote.timeSinceGrounded = Number.POSITIVE_INFINITY
    } else if (prevJump && !input.jump && velocity.y > 0) {
      // 5. Variable jump: releasing while still rising clips the arc, once per jump.
      velocity.y *= JUMP_CUTOFF_FACTOR
    }

    // 6. Collide. There is no wall jump and no wall slide: hitting a wall only zeroes vx.
    moveAndCollide(body, dt, grid, sweep)
    player.grounded = sweep.grounded
    updateCoyoteTimer(coyote, player.grounded, dt)

    // 7. Turn. A lerped Y rotation, so the model swings around rather than flipping.
    if (intent !== 0) targetYaw = intent > 0 ? FACE_RIGHT : FACE_LEFT
    player.facingYaw += (targetYaw - player.facingYaw) * Math.min(1, TURN_RATE * dt)
    mesh.rotation.y = player.facingYaw
    mesh.position.set(body.aabb.x + PLAYER_WIDTH / 2, body.aabb.y + PLAYER_HEIGHT / 2, GAMEPLAY_Z)

    prevJump = input.jump
  }

  const player: Player = {
    body,
    mesh,
    coyote,
    jumpBuffer,
    facingYaw: FACE_RIGHT,
    grounded: false,
    step,
  }
  return player
}
