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

// Squash and stretch is decoration: it drives mesh.scale only. body.aabb never changes size,
// so the hitbox a player collides with is identical whether the mesh is stretched or not.
/** Extra Y scale at jump launch: the mesh reaches 1.25 tall, then fades back with the rise. */
export const JUMP_STRETCH = 0.25

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
  // A launched jump that has not yet spent its one cutoff. Latched per jump rather than read
  // off a live release edge, so a press buffered and released in mid-air still clips its arc.
  let cutPending = false
  // Latched at launch rather than derived from "airborne", so walking off a ledge never stretches.
  let stretching = false
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
    const dashing = input.dash
    const maxSpeed = dashing ? DASH_MAX : WALK_MAX
    const baseAccel = player.grounded ? GROUND_ACCEL : AIR_ACCEL
    // Dash ramps in proportion to its higher cap, so it saturates in the same 0.2 s walk does.
    // Sharing GROUND_ACCEL made a short burst pay out ~1.35x walk instead of the spec's 1.6x.
    const accel = dashing ? baseAccel * (DASH_MAX / WALK_MAX) : baseAccel
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
      cutPending = true
      stretching = true
    } else if (cutPending && !input.jump && velocity.y > 0) {
      // 5. Variable jump: the first rising frame with the button not held clips the arc, once
      // per jump. A buffered press arrives already released, so it clips right after launch.
      velocity.y *= JUMP_CUTOFF_FACTOR
      cutPending = false
    }

    // 6. Collide. There is no wall jump and no wall slide: hitting a wall only zeroes vx.
    const wasGrounded = player.grounded
    moveAndCollide(body, dt, grid, sweep)
    player.grounded = sweep.grounded
    updateCoyoteTimer(coyote, player.grounded, dt)

    // 7. Turn. A lerped Y rotation, so the model swings around rather than flipping.
    if (intent !== 0) targetYaw = intent > 0 ? FACE_RIGHT : FACE_LEFT
    player.facingYaw += (targetYaw - player.facingYaw) * Math.min(1, TURN_RATE * dt)
    mesh.rotation.y = player.facingYaw
    mesh.position.set(body.aabb.x + PLAYER_WIDTH / 2, body.aabb.y + PLAYER_HEIGHT / 2, GAMEPLAY_Z)

    // 8. Squash and stretch. Mesh scale only — the simulation never reads it back.
    if (!wasGrounded && player.grounded) stretching = false
    const scaleY =
      stretching && velocity.y > 0
        ? 1 + JUMP_STRETCH * Math.min(1, velocity.y / JUMP_VELOCITY)
        : 1
    const scaleXZ = 1 / Math.sqrt(scaleY)
    mesh.scale.set(scaleXZ, scaleY, scaleXZ)

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
