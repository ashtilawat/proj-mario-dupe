// T-007 — M0 boss stand-in: the one and only boss class for this milestone. It is a
// gray-box placeholder for pattern tuning, deliberately NOT wired into any level yet.
//
// Units: the hitbox is a 2D AABB in TILE space (1 tile = 1.0, bottom-left origin, Y up so
// vy < 0 is falling). The box mesh is purely cosmetic and lives in WORLD units, where
// TILE_SIZE world units make one tile; the mesh bounds are deliberately decoupled from the
// hitbox so art can grow without changing what the fight feels like.
//
// The fight is fully deterministic: every transition is driven by the accumulated dt and
// by sweep results, never by a clock or a random draw. Given the same dt sequence and the
// same stomps, two bosses produce byte-identical traces.

import * as THREE from 'three'
import {
  GRAVITY,
  STOMP_BOUNCE,
  TERMINAL_VELOCITY,
  TILE_SIZE,
  moveAndCollide,
  overlaps,
  top,
} from '../../physics/index.ts'
import type { Aabb, Body, SweepResult, TileGrid, Vec2 } from '../../physics/index.ts'

/** How much of the fight is left. Phase 3 is the last one; a stomp there defeats it. */
export type BossPhase = 1 | 2 | 3

/** Where the boss is in the hold → telegraph → attack → recover loop. */
export type BossState = 'idle' | 'telegraph' | 'attack' | 'recover' | 'dead'

/** Which way the boss charges. +1 is +X. */
export type BossFacing = 1 | -1

/** Spawn description, matching the `at` shape a level entity would provide. */
export interface BossSpawn {
  x: number
  y: number
  dir?: BossFacing
  id?: number
}

/** Hitbox size in tiles — three tiles wide and tall, so it reads as a wall of a creature. */
export const BOSS_WIDTH = 3
export const BOSS_HEIGHT = 3

/** Mesh size in tiles. Slightly larger than the hitbox: art overhangs, gameplay does not. */
export const BOSS_MESH_WIDTH = 3.5
export const BOSS_MESH_HEIGHT = 3.25
export const BOSS_MESH_DEPTH = 1.5

/** Motionless hold before the wind-up, seconds. */
export const IDLE_S = 0.5
/** The wind-up itself: the window the attack is readable in, seconds. */
export const TELEGRAPH_S = 0.6
/** Vulnerable cool-down after an attack resolves, seconds. */
export const RECOVER_S = 0.7
/** Hard cap on an attack so a wedged boss still cycles, seconds. */
export const ATTACK_TIMEOUT_S = 2

/** Phase 1: a short hop before the slam, tiles/s. */
export const HOP_SPEED = 12
/** Phase 3: a tall jump before the slam, tiles/s. */
export const JUMP_SPEED = 20
/** Downward velocity forced at the apex of a slam, tiles/s. */
export const SLAM_SPEED = 22
/** Phase 2: horizontal charge speed, tiles/s, and how long it runs. */
export const CHARGE_SPEED = 8
export const CHARGE_S = 0.8

/** Gray-box placeholder art until real assets land. */
const BOSS_COLOR = 0x7a7a7a
/** Brighter gray during the wind-up, so the tell is visible without any VFX. */
const TELEGRAPH_COLOR = 0xd6d6d6

/** Gameplay entities sit on the Z = 0 plane. */
const GAMEPLAY_Z = 0

export class BossStandin implements Body {
  readonly id: number
  readonly aabb: Aabb
  readonly velocity: Vec2
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>

  phase: BossPhase = 1
  state: BossState = 'idle'
  /** Seconds left in the current state. Attacks may end early on a landing or a wall. */
  stateRemaining = IDLE_S
  /** Which way the next charge runs; flipped after every charge. */
  dir: BossFacing
  /** Successful stomps taken so far, 0..3. */
  stompCount = 0
  alive = true
  defeated = false

  /** True once the current slam has been pulled down at its apex. */
  private slammed = false
  /** Reused so a 120 Hz loop allocates nothing per step. */
  private readonly sweep: SweepResult = { x: 0, y: 0, hitX: false, hitY: false, grounded: false }

  constructor(spawn: BossSpawn) {
    this.id = spawn.id ?? 0
    this.dir = spawn.dir ?? 1
    this.aabb = { x: spawn.x, y: spawn.y, w: BOSS_WIDTH, h: BOSS_HEIGHT }
    this.velocity = { x: 0, y: 0 }
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        BOSS_MESH_WIDTH * TILE_SIZE,
        BOSS_MESH_HEIGHT * TILE_SIZE,
        BOSS_MESH_DEPTH * TILE_SIZE,
      ),
      new THREE.MeshLambertMaterial({ color: BOSS_COLOR }),
    )
    this.syncMesh()
  }

  /** True only during the wind-up window, when the coming attack is readable. */
  get telegraphing(): boolean {
    return this.state === 'telegraph'
  }

  /** Seconds of wind-up left, or 0 when not winding up. */
  get telegraphRemaining(): number {
    return this.state === 'telegraph' ? this.stateRemaining : 0
  }

  /** Seconds of attack left before it times out, or 0 when not attacking. */
  get attackRemaining(): number {
    return this.state === 'attack' ? this.stateRemaining : 0
  }

  /** Advance one fixed step: gravity, the phase pattern, then the swept move. */
  step(dt: number, grid: TileGrid): void {
    if (!this.alive) return

    // moveAndCollide never applies gravity, so it has to be re-applied every step.
    this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -TERMINAL_VELOCITY)

    this.advanceState(dt)
    const result = moveAndCollide(this, dt, grid, this.sweep)
    this.resolveAttackEnd(result)

    this.syncMesh()
  }

  /**
   * Resolve a stomp attempt. A stomp only counts when the stomper is moving down, was
   * entirely above the boss's top last frame, and overlaps it now — the same rule the
   * walking enemies use, with no size or power-up requirement, so the smallest player
   * hitbox can finish the fight. Each hit costs one phase; the third one ends it.
   *
   * @returns the upward velocity the stomper should take (STOMP_BOUNCE), or 0 for no stomp.
   */
  tryStomp(stomperAabb: Aabb, stomperVy: number, stomperPrevBottom: number): number {
    if (!this.alive) return 0
    if (stomperVy >= 0) return 0
    if (stomperPrevBottom < top(this.aabb)) return 0
    if (!overlaps(stomperAabb, this.aabb)) return 0

    this.stompCount += 1
    this.velocity.x = 0
    this.velocity.y = 0
    this.slammed = false

    if (this.phase === 3) {
      this.alive = false
      this.defeated = true
      this.state = 'dead'
      this.stateRemaining = 0
      this.setColor(BOSS_COLOR)
      return STOMP_BOUNCE
    }

    // Damage interrupts whatever was in progress and restarts the loop one phase angrier.
    this.phase = this.phase === 1 ? 2 : 3
    this.enterIdle()
    return STOMP_BOUNCE
  }

  /** Tick the current state's timer and run its motion. */
  private advanceState(dt: number): void {
    this.stateRemaining -= dt

    switch (this.state) {
      case 'idle':
      case 'recover':
        this.velocity.x = 0
        if (this.stateRemaining <= 0) {
          if (this.state === 'idle') this.enterTelegraph()
          else this.enterIdle()
        }
        break
      case 'telegraph':
        // Braced and still: the whole point of the window is that nothing moves yet.
        this.velocity.x = 0
        if (this.stateRemaining <= 0) this.enterAttack()
        break
      case 'attack':
        this.driveAttack()
        break
      case 'dead':
        this.velocity.x = 0
        break
    }
  }

  /** Per-tick attack motion: hold the charge speed, or pull a slam down at its apex. */
  private driveAttack(): void {
    if (this.phase === 2) {
      // moveAndCollide zeroes vx on a wall hit, so the charge is re-asserted every tick.
      this.velocity.x = this.dir * CHARGE_SPEED
      return
    }
    if (!this.slammed && this.velocity.y <= 0) {
      this.velocity.y = -SLAM_SPEED
      this.slammed = true
    }
  }

  /** An attack ends on the landing (or wall) it was aiming for, or when it times out. */
  private resolveAttackEnd(result: SweepResult): void {
    if (this.state !== 'attack') return

    const finished = this.phase === 2 ? result.hitX : result.grounded
    if (!finished && this.stateRemaining > 0) return

    if (this.phase === 2) this.dir = this.dir === 1 ? -1 : 1
    this.state = 'recover'
    this.stateRemaining = RECOVER_S
    this.velocity.x = 0
    this.slammed = false
  }

  private enterIdle(): void {
    this.state = 'idle'
    this.stateRemaining = IDLE_S
    this.velocity.x = 0
    this.setColor(BOSS_COLOR)
  }

  private enterTelegraph(): void {
    this.state = 'telegraph'
    this.stateRemaining = TELEGRAPH_S
    this.velocity.x = 0
    this.setColor(TELEGRAPH_COLOR)
  }

  /** Commit to this phase's pattern. Every impulse below is a fixed number. */
  private enterAttack(): void {
    this.state = 'attack'
    this.slammed = false
    this.setColor(BOSS_COLOR)

    switch (this.phase) {
      case 1:
        // Hop, then get yanked back down at the apex.
        this.stateRemaining = ATTACK_TIMEOUT_S
        this.velocity.y = HOP_SPEED
        break
      case 2:
        this.stateRemaining = CHARGE_S
        this.velocity.x = this.dir * CHARGE_SPEED
        break
      case 3:
        // Same slam, from much higher up.
        this.stateRemaining = ATTACK_TIMEOUT_S
        this.velocity.y = JUMP_SPEED
        break
    }
  }

  private setColor(hex: number): void {
    this.mesh.material.color.setHex(hex)
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

/** Factory taking a level spawn point. */
export function createBossStandin(spawn: BossSpawn): BossStandin {
  return new BossStandin(spawn)
}
