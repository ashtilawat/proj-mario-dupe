// T-007 — M0 boss stand-in: the one and only boss class for this milestone. T-050 replaced
// its gray box with a crowned king, built the way the player (T-033) and the walker (T-030)
// are: flat-coloured boxes merged into ONE geometry drawn by ONE material.
//
// Units: the hitbox is a 2D AABB in TILE space (1 tile = 1.0, bottom-left origin, Y up so
// vy < 0 is falling). The king mesh is purely cosmetic and lives in WORLD units, where
// TILE_SIZE world units make one tile; the mesh bounds are deliberately decoupled from the
// hitbox so art can grow without changing what the fight feels like.
//
// The fight is fully deterministic: every transition is driven by the accumulated dt and
// by sweep results, never by a clock or a random draw. Given the same dt sequence and the
// same stomps, two bosses produce byte-identical traces.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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

/**
 * The art's own silhouette bounds, in tiles. Slightly larger than the hitbox: art
 * overhangs, gameplay does not. Deliberately NOT the BOSS_WIDTH/BOSS_HEIGHT hitbox
 * constants — sizing art off the hitbox means retuning the hitbox silently deforms the
 * king. The king fills all three exactly: 3.5 across at the robe hem, 3.25 hem to crown
 * tip, 1.5 deep. Interior proportions are authored in BOSS_PARTS below, not derived from
 * these, so widening a span moves the parts that reference it and leaves the rest put.
 */
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

/**
 * The idle tint, and deliberately NOT white — which is where this parts company with the
 * player and the walker, who both leave `material.color` alone. Lambert multiplies
 * material.color by the vertex colour, and `setColor` is this boss's whole telegraph tell,
 * so the idle tint has to sit below white for the wind-up to have anything to flash up to.
 * The vertex colours below are authored bright enough to land where they should after it.
 */
const BOSS_COLOR = 0xb3b3b3
/** Warm gold flash during the wind-up, so the tell is visible without any VFX. */
const TELEGRAPH_COLOR = 0xffe6a3

/** Gameplay entities sit on the Z = 0 plane. */
const GAMEPLAY_Z = 0

// T-050 king art. Colours are flat-filled per vertex so ONE material draws the robe, the
// collar, the head and the crown. The mesh has to stay a single Mesh with one geometry and
// one non-array material: the disposal idiom main.ts uses on boss meshes is
// `mesh.geometry.dispose(); mesh.material.dispose()`, which a Group of children would leak
// straight past, and geometry groups would demand a material array a single dispose()
// cannot free.
/** The robe hem, shaded: the widest part, and the one that carries the flare. */
const ROBE_HEM_COLOR = 0x3a2568
const ROBE_COLOR = 0x5b3a9e
/** Ermine trim — the one light band in the silhouette, so the head reads off the robe. */
const COLLAR_COLOR = 0xefe6d8
const HEAD_COLOR = 0x6f9e4a
const CROWN_BAND_COLOR = 0xd9a318
/** The points, a shade brighter than the band: they catch light the flat band does not,
 * and carrying their own colour is what lets a test see them as three separate spikes. */
const CROWN_POINT_COLOR = 0xffd75e
const JEWEL_COLOR = 0xd83c5e

/** Half the height, since every part is placed relative to the mesh centre. */
const HALF_Y = BOSS_MESH_HEIGHT / 2
/** Half the width: the robe hem reaches it on both sides, and nothing goes past it. */
const HALF_X = BOSS_MESH_WIDTH / 2

/** One flat-coloured box of the king, as local bounds in TILES around the mesh centre. */
interface BossPart {
  minX: number
  maxX: number
  minY: number
  maxY: number
  depth: number
  /** Z centre. Only the jewel leaves 0, to sit proud of the crown band's front face. */
  zOffset?: number
  color: number
}

/**
 * The king, bottom to top, centred on the origin so Y runs -HALF_Y to +HALF_Y and the robe
 * settles on the hitbox once `syncMesh` parks the mesh on the AABB centre.
 *
 * Two wide-over-narrow steps carry the read. The hem flares out past the robe, which is
 * what makes the bottom say "robe" rather than "column", and the crown band overhangs the
 * head, which is what makes the top say "crown" rather than "block" — the same trick the
 * player's hat brim uses. The three points are separate boxes with a 0.34-tile gap between
 * them, so they never merge into a second band at any zoom.
 *
 * Neighbours overlap in Y by 0.03-0.05 so no join can open a seam or z-fight.
 */
const BOSS_PARTS: readonly BossPart[] = [
  {
    minX: -HALF_X,
    maxX: HALF_X,
    minY: -HALF_Y,
    maxY: -0.6,
    depth: BOSS_MESH_DEPTH,
    color: ROBE_HEM_COLOR,
  },
  { minX: -1.3, maxX: 1.3, minY: -0.65, maxY: 0.3, depth: 1.25, color: ROBE_COLOR },
  { minX: -1.45, maxX: 1.45, minY: 0.26, maxY: 0.52, depth: 1.35, color: COLLAR_COLOR },
  { minX: -0.75, maxX: 0.75, minY: 0.48, maxY: 1.1, depth: 1.05, color: HEAD_COLOR },
  { minX: -0.9, maxX: 0.9, minY: 1.05, maxY: 1.35, depth: 1.2, color: CROWN_BAND_COLOR },
  { minX: -0.7, maxX: -0.46, minY: 1.32, maxY: HALF_Y, depth: 1.2, color: CROWN_POINT_COLOR },
  { minX: -0.12, maxX: 0.12, minY: 1.32, maxY: HALF_Y, depth: 1.2, color: CROWN_POINT_COLOR },
  { minX: 0.46, maxX: 0.7, minY: 1.32, maxY: HALF_Y, depth: 1.2, color: CROWN_POINT_COLOR },
  // Sunk 0.05 into the band and standing 0.08 clear of it, still inside BOSS_MESH_DEPTH.
  {
    minX: -0.16,
    maxX: 0.16,
    minY: 1.09,
    maxY: 1.31,
    depth: 0.13,
    zOffset: 0.615,
    color: JEWEL_COLOR,
  },
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
 * A crown over a head over a robe, merged into ONE geometry. Built in world units, like the
 * walker's mushroom and unlike the player's character: `syncMesh` positions this mesh in
 * world units, so the geometry has to be scaled by TILE_SIZE to match its own placement.
 *
 * mergeGeometries keeps useGroups false, so the result carries no groups — groups would
 * demand a material array, which main.ts's single `material.dispose()` cannot free.
 */
function createKingGeometry(): THREE.BufferGeometry {
  const boxes = BOSS_PARTS.map((part) => {
    const box = new THREE.BoxGeometry(
      (part.maxX - part.minX) * TILE_SIZE,
      (part.maxY - part.minY) * TILE_SIZE,
      part.depth * TILE_SIZE,
    )
    box.translate(
      ((part.minX + part.maxX) / 2) * TILE_SIZE,
      ((part.minY + part.maxY) / 2) * TILE_SIZE,
      (part.zOffset ?? 0) * TILE_SIZE,
    )
    paint(box, part.color)
    return box
  })

  // Typed non-null, but the implementation returns null when attribute sets disagree — fail
  // here rather than handing main.ts a null geometry to dispose().
  const merged = mergeGeometries(boxes)
  if (merged === null) throw new Error('boss: king part attributes are incompatible')

  // Only the merged geometry is reachable from main.ts, so free the sources here.
  for (const box of boxes) box.dispose()
  return merged
}

export class BossStandin implements Body {
  readonly id: number
  readonly aabb: Aabb
  readonly velocity: Vec2
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>

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
      createKingGeometry(),
      // Tinted rather than left white the way the player and the walker leave it: see
      // BOSS_COLOR. setColor drives this tint, and only this tint — the vertex colours are
      // fixed, so the flash brightens the whole king without repainting a single vertex.
      new THREE.MeshLambertMaterial({ vertexColors: true, color: BOSS_COLOR }),
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
