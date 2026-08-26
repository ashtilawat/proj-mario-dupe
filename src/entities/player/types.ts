import type { Body, CoyoteTimer, JumpBuffer, TileGrid } from '../../physics/index.ts'
import type * as THREE from 'three'

/**
 * One frame of player intent. This is the engine's {@link InputState} plus `dash`, which
 * the engine deliberately does not know about — see `createDashInput` for the Shift keys.
 */
export interface PlayerInput {
  left?: boolean
  right?: boolean
  up?: boolean
  down?: boolean
  jump: boolean
  dash: boolean
  /** Horizontal intent in [-1, 1]. Wins over `left`/`right` when non-zero. */
  moveX: number
}

export interface PlayerOptions {
  /** Left edge of the spawn hitbox, in tile space. */
  x: number
  /** Bottom edge of the spawn hitbox, in tile space (Y up). */
  y: number
  grid: TileGrid
  /** Visual stand-in. Defaults to the render module's capsule. */
  mesh?: THREE.Object3D
}

export interface Player {
  /** The 2D hitbox and velocity. This — never the mesh — is what collides. */
  readonly body: Body
  /** Visual only. Driven by the body every step; never read back by the simulation. */
  readonly mesh: THREE.Object3D
  readonly coyote: CoyoteTimer
  readonly jumpBuffer: JumpBuffer
  /** Y-axis facing in radians: 0 faces +X, Math.PI faces -X. Mirrors `mesh.rotation.y`. */
  facingYaw: number
  /** Result of the most recent sweep. */
  grounded: boolean
  step(dt: number, input: PlayerInput): void
}
