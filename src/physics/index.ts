// Custom 2D tile-space physics for the 2.5D platformer. No third-party physics engine:
// hitboxes are plain AABBs in tile space, fully decoupled from any 3D model bounds.
//
// Units: one tile is 1.0 x 1.0; TILE_SIZE converts to world/render units. Y is up, so a
// falling body has vy < 0. Times are seconds.

export type { Aabb, Body, SweepResult, TileGrid, TileKind, Vec2 } from './types.ts'
export type { TileRange } from './tilemap.ts'
export type { CoyoteTimer, JumpBuffer } from './timers.ts'

export {
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
} from './constants.ts'

export { bottom, left, overlaps, right, top } from './aabb.ts'
export { isOneWaySolid, tileRange } from './tilemap.ts'
export { moveAndCollide, sweepAabb } from './sweep.ts'
export {
  canCoyoteJump,
  consumeJumpBuffer,
  createCoyoteTimer,
  createJumpBuffer,
  isJumpBuffered,
  pressJump,
  updateCoyoteTimer,
  updateJumpBuffer,
} from './timers.ts'
