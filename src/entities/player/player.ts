import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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
import { GAMEPLAY_Z } from '../../render/index.ts'
import type { Player, PlayerInput, PlayerOptions } from './types.ts'

// The hitbox is a plain AABB in tile space and the mesh never takes part in collision. The
// T-033 character is built to the same 0.7 x 1.5 silhouette so the art sits inside the box,
// but it sizes itself from its own MESH_SPAN_* constants below — see the note there.
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
/** Deepest landing squash: the mesh bottoms out at 0.7 tall on a full-height fall. */
export const LAND_SQUASH_MAX = 0.3
/** Landings slower than this (tiles/s) do not squash, so spawn settling is not a touchdown. */
export const LAND_SQUASH_MIN_SPEED = 4.0
/** Squash shed per second. The deepest squash recovers to identity in 0.125 s. */
export const SQUASH_RECOVER_RATE = 2.4

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

// T-033 character art. Colours are flat-filled per vertex so ONE material draws the hat,
// head, overalls and shoes. The mesh has to stay a single Mesh with one geometry and one
// non-array material: squash and stretch scales the root as a whole, and the disposal idiom
// this codebase uses on entity meshes is `mesh.geometry.dispose(); mesh.material.dispose()`,
// which a Group of children would leak straight past.
const HAT_COLOR = 0xe0392b
const HEAD_COLOR = 0xe8c547
const OVERALLS_COLOR = 0x2e5bbf
const SHOES_COLOR = 0x4a2f1b

/**
 * The art's own silhouette size, in tiles. Deliberately NOT the PLAYER_WIDTH/PLAYER_HEIGHT
 * hitbox constants: sizing art off the hitbox means retuning the hitbox silently deforms the
 * character. They happen to match today, so the character fills the box the capsule did.
 *
 * Unscaled by TILE_SIZE, unlike `walker.ts`. `step` positions this mesh in raw tile units
 * (`body.aabb.x + PLAYER_WIDTH / 2`), so scaling the geometry would decouple the art from
 * its own placement.
 */
const MESH_SPAN_X = 0.7
const MESH_SPAN_Y = 1.5
/** Every part is placed relative to the mesh centre, so half spans are what the table needs. */
const HALF_X = MESH_SPAN_X / 2
const HALF_Y = MESH_SPAN_Y / 2

/** One flat-coloured box of the character, as local bounds around the mesh centre. */
interface PlayerPart {
  minX: number
  maxX: number
  minY: number
  maxY: number
  depth: number
  color: number
}

/**
 * The character, bottom to top, centred on the origin so Y runs -HALF_Y to +HALF_Y and the
 * feet land on the hitbox bottom once `step` parks the mesh on the AABB centre.
 *
 * Two choices carry the read. The hat brim is the widest part and overhangs the head, which
 * is what makes the top say "hat" rather than "block". And the brim and shoes are front-heavy
 * in +X: the capsule was rotationally symmetric about Y, so the TURN_RATE lerp in `step` drew
 * nothing — giving the character a front is what makes the turn visible.
 *
 * Neighbours overlap in Y by ~0.02 so no join can open a seam or z-fight.
 */
const PLAYER_PARTS: readonly PlayerPart[] = [
  { minX: -0.2, maxX: HALF_X, minY: -HALF_Y, maxY: -0.59, depth: 0.44, color: SHOES_COLOR },
  { minX: -0.26, maxX: 0.26, minY: -0.62, maxY: -0.05, depth: 0.4, color: OVERALLS_COLOR },
  { minX: -0.23, maxX: 0.23, minY: -0.07, maxY: 0.35, depth: 0.42, color: HEAD_COLOR },
  { minX: -0.24, maxX: HALF_X, minY: 0.33, maxY: 0.45, depth: 0.5, color: HAT_COLOR },
  { minX: -0.21, maxX: 0.21, minY: 0.43, maxY: HALF_Y, depth: 0.4, color: HAT_COLOR },
]

/** Flat-fill a geometry's vertices so the merged mesh keeps its parts distinguishable. */
function paint(geometry: THREE.BufferGeometry, hex: number): void {
  const { r, g, b } = new THREE.Color(hex)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/**
 * The player character: a red hat over a head, blue overalls and shoes, merged into ONE
 * geometry drawn by ONE material. Exported so tests can read the geometry without casting
 * through the THREE.Object3D that `Player.mesh` is typed as.
 */
export function createPlayerMesh(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const boxes = PLAYER_PARTS.map((part) => {
    const box = new THREE.BoxGeometry(part.maxX - part.minX, part.maxY - part.minY, part.depth)
    box.translate((part.minX + part.maxX) / 2, (part.minY + part.maxY) / 2, 0)
    paint(box, part.color)
    return box
  })

  // Typed non-null, but the implementation returns null when attribute sets disagree — fail
  // here rather than handing a null geometry to whatever disposes it later.
  const merged = mergeGeometries(boxes)
  if (merged === null) throw new Error('player: character part attributes are incompatible')

  // Only the merged geometry is reachable from here on, so free the sources.
  for (const box of boxes) box.dispose()

  return new THREE.Mesh(
    merged,
    // Left white: Lambert multiplies material.color by the vertex colour, so a tint here
    // would darken every part of the character at once.
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  )
}

export function createPlayer(options: PlayerOptions): Player {
  const { grid } = options
  const body: Body = {
    aabb: { x: options.x, y: options.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT },
    velocity: { x: 0, y: 0 },
  }
  const mesh = options.mesh ?? createPlayerMesh()
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
  // Current landing squash in [0, LAND_SQUASH_MAX]. Zero whenever the mesh is at rest.
  let squash = 0
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
    // The sweep zeroes vy on contact, so the landing impact has to be read before it runs.
    const impactSpeed = -velocity.y
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
    if (!wasGrounded && player.grounded) {
      stretching = false
      if (impactSpeed >= LAND_SQUASH_MIN_SPEED) {
        squash = LAND_SQUASH_MAX * Math.min(1, impactSpeed / JUMP_VELOCITY)
      }
    } else {
      // moveToward snaps to the target, so the mesh settles on a bit-exact identity scale.
      squash = moveToward(squash, 0, SQUASH_RECOVER_RATE * dt)
    }
    const scaleY =
      stretching && velocity.y > 0
        ? 1 + JUMP_STRETCH * Math.min(1, velocity.y / JUMP_VELOCITY)
        : 1 - squash
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
