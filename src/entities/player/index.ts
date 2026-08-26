// The player entity: run, dash, variable jump, coyote time and jump buffering on top of
// the tile-space physics in src/physics. The hitbox is a 2D AABB; the mesh is decoration.
export type { Player, PlayerInput, PlayerOptions } from './types.ts'
export type { DashInput } from './dash.ts'
export { createDashInput } from './dash.ts'
export {
  FACE_LEFT,
  FACE_RIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TURN_RATE,
  createPlayer,
} from './player.ts'
