// T-006 — M0 walker enemy: the one and only enemy class for this milestone.
//
// Units: the hitbox is a 2D AABB in TILE space (1 tile = 1.0, bottom-left origin, Y up so
// vy < 0 is falling). The gray-box mesh is purely cosmetic and lives in WORLD units, where
// TILE_SIZE world units make one tile; the mesh bounds are deliberately decoupled from the
// hitbox so art can change without touching gameplay.

import * as THREE from 'three'
import {
  GRAVITY,
  STOMP_BOUNCE,
  TERMINAL_VELOCITY,
  TILE_SIZE,
  WALK_MAX,
  moveAndCollide,
  overlaps,
  top,
} from '../../physics/index.ts'
import type { Aabb, Body, SweepResult, TileGrid, Vec2 } from '../../physics/index.ts'

/** Which way a walker faces and moves. +1 is +X. */
export type WalkerFacing = 1 | -1

/** Spawn description, matching a level entity's `at` and `props.dir`. */
export interface WalkerSpawn {
  x: number
  y: number
  dir?: WalkerFacing
  id?: number
}

/** Patrol speed in tiles/s — a constant stroll, a third of the player's walk. */
export const WALKER_PATROL_SPEED = WALK_MAX / 3

/** Hitbox size in tiles. */
export const WALKER_WIDTH = 1
export const WALKER_HEIGHT = 1

/** Gray-box placeholder art until real assets land. */
const WALKER_COLOR = 0x9a9a9a

/** Gameplay entities sit on the Z = 0 plane. */
const GAMEPLAY_Z = 0

/** Keeps foot/ledge probes just inside the tile they are meant to sample. */
const PROBE_EPS = 1e-4

export class Walker implements Body {
  readonly id: number
  readonly aabb: Aabb
  readonly velocity: Vec2
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>
  dir: WalkerFacing
  alive = true
  stomped = false

  /** Downward sweep hit from the previous step; gravity is re-applied regardless. */
  private grounded = false
  /** Reused so a 120 Hz loop allocates nothing per step. */
  private readonly sweep: SweepResult = { x: 0, y: 0, hitX: false, hitY: false, grounded: false }

  constructor(spawn: WalkerSpawn) {
    this.id = spawn.id ?? 0
    this.dir = spawn.dir ?? 1
    this.aabb = { x: spawn.x, y: spawn.y, w: WALKER_WIDTH, h: WALKER_HEIGHT }
    this.velocity = { x: 0, y: 0 }
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(WALKER_WIDTH * TILE_SIZE, WALKER_HEIGHT * TILE_SIZE, TILE_SIZE),
      new THREE.MeshLambertMaterial({ color: WALKER_COLOR }),
    )
    this.syncMesh()
  }

  /** Advance one fixed step: gravity, turn checks, then the swept move. */
  step(dt: number, grid: TileGrid): void {
    if (!this.alive) return

    // moveAndCollide never applies gravity, and `grounded` is only a downward-sweep hit,
    // so gravity has to be re-applied every step to stay pinned to the floor.
    this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -TERMINAL_VELOCITY)

    // Turn before moving when the next footstep would leave the walker unsupported.
    if (this.grounded && !this.hasGroundAhead(dt, grid)) this.turn()
    this.velocity.x = this.dir * WALKER_PATROL_SPEED

    const result = moveAndCollide(this, dt, grid, this.sweep)
    // A wall stopped the X sweep, so face the other way for the next step.
    if (result.hitX) this.turn()
    this.grounded = result.grounded

    this.syncMesh()
  }

  /**
   * Resolve a stomp attempt. A stomp only counts when the stomper is moving down, was
   * entirely above this walker's top last frame, and overlaps it now.
   *
   * @returns the upward velocity the stomper should take (STOMP_BOUNCE), or 0 for no stomp.
   */
  tryStomp(stomperAabb: Aabb, stomperVy: number, stomperPrevBottom: number): number {
    if (!this.alive) return 0
    if (stomperVy >= 0) return 0
    if (stomperPrevBottom < top(this.aabb)) return 0
    if (!overlaps(stomperAabb, this.aabb)) return 0

    // Defeated in place — the walker itself is never launched.
    this.alive = false
    this.stomped = true
    this.velocity.x = 0
    this.velocity.y = 0
    return STOMP_BOUNCE
  }

  private turn(): void {
    this.dir = this.dir === 1 ? -1 : 1
  }

  /** Would the tile under the leading foot still support the walker after this step? */
  private hasGroundAhead(dt: number, grid: TileGrid): boolean {
    const nextX = this.aabb.x + this.dir * WALKER_PATROL_SPEED * dt
    const footX = this.dir > 0 ? nextX + this.aabb.w - PROBE_EPS : nextX + PROBE_EPS
    const tx = Math.floor(footX)
    const ty = Math.floor(this.aabb.y - PROBE_EPS)
    if (tx < 0 || tx >= grid.width || ty < 0 || ty >= grid.height) return false
    return grid.getTile(tx, ty) !== 'empty'
  }

  /** Mesh is visual only: centre it on the hitbox, converted to world units. */
  private syncMesh(): void {
    this.mesh.position.set(
      (this.aabb.x + this.aabb.w / 2) * TILE_SIZE,
      (this.aabb.y + this.aabb.h / 2) * TILE_SIZE,
      GAMEPLAY_Z,
    )
  }
}

/** Factory taking a level spawn point and facing direction. */
export function createWalker(spawn: WalkerSpawn): Walker {
  return new Walker(spawn)
}
