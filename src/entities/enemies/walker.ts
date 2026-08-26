// T-006 — M0 walker enemy: the one and only enemy class for this milestone.
//
// Units: the hitbox is a 2D AABB in TILE space (1 tile = 1.0, bottom-left origin, Y up so
// vy < 0 is falling). The toadstool mesh (T-060) is purely cosmetic and lives in WORLD units,
// where TILE_SIZE world units make one tile; the mesh bounds are deliberately decoupled from
// the hitbox so art can change without touching gameplay.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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

/** Mushroom colours, applied per vertex so one material draws all three parts. */
const WALKER_CAP_COLOR = 0xc4362f
const WALKER_STEM_COLOR = 0xf2e2c4
/**
 * The spots carry their own hex rather than reusing the stem's cream. `paint` flat-fills
 * per part, so a shared colour would fold the spots into the stem — and brighter than the
 * stem is also what makes them read against the red, the way the king's crown points sit
 * a shade above his band.
 */
const WALKER_SPOT_COLOR = 0xfff4e0

/**
 * The toadstool, in tiles, as local offsets from the mesh centre. MESH_SPAN is the art's
 * own silhouette size, deliberately NOT the WALKER_HEIGHT hitbox constant, so retuning the
 * hitbox cannot squash the mushroom.
 *
 * A round cap cannot kiss the corners of its tile, so the art stays INSIDE the 1x1x1 tile
 * the gray box used to fill rather than filling it. One measurement must stay exact
 * regardless: the stem's foot sits at -MESH_SPAN / 2, which is where `syncMesh` centring
 * the mesh on a one-tile AABB puts the walker's feet on the floor.
 */
const MESH_SPAN = 1

/** Cap: a quarter-ellipse of this half-width and height, revolved into a bell. */
const CAP_RADIUS = 0.46
const CAP_HEIGHT = 0.32
/** The rim's height, so the dome runs from CAP_RIM_Y up to CAP_RIM_Y + CAP_HEIGHT. */
const CAP_RIM_Y = 0.1
/** 20 segments divide the turn into 18 degrees, so a vertex lands on the cap's widest
 * point and the silhouette's half-width is CAP_RADIUS rather than a segment artefact. */
const CAP_RADIAL_SEGMENTS = 20
/** Profile samples from rim to apex; eight loses the facets at the size this is drawn. */
const CAP_PROFILE_STEPS = 8

const STEM_TOP_RADIUS = 0.15
/** Wider at the foot than the top, so the stem plants rather than floats. */
const STEM_FOOT_RADIUS = 0.19
/** 16 segments divide the turn into 22.5 degrees, exact at 90 like the cap's 20. */
const STEM_RADIAL_SEGMENTS = 16
/** How far the stem's top pushes up inside the cap so the join cannot open or z-fight. */
const NECK_OVERLAP = 0.04

/** A paper dot on the cap: where it sits on the dome and how big it is cut. */
interface CapSpot {
  /** Degrees around Y from +Z, the face the camera sees. */
  azimuth: number
  /** Degrees down from the apex. */
  polar: number
  radius: number
}

/**
 * Five spots, sized and placed by hand so the cap looks cut rather than stamped. Every
 * polar angle stays within 33-55 degrees and every azimuth within +/-62: nearer the apex
 * and a lifted spot clears the tile's ceiling, nearer the rim and it hangs over the edge.
 */
const CAP_SPOTS: readonly CapSpot[] = [
  { azimuth: -62, polar: 46, radius: 0.075 },
  { azimuth: -20, polar: 33, radius: 0.055 },
  { azimuth: 4, polar: 55, radius: 0.06 },
  { azimuth: 22, polar: 52, radius: 0.07 },
  { azimuth: 58, polar: 36, radius: 0.05 },
]

/**
 * How far a spot stands off the cap, along the normal at its centre. The disc is laid on
 * the tangent plane of a convex dome, so it is the CENTRE that sits closest to the surface
 * and the rim that lifts away — this value is the whole of the clearance, not a margin on
 * top of one. Small enough to read as painted on, large enough not to z-fight.
 */
const SPOT_LIFT = 0.012
const SPOT_SEGMENTS = 10

/** Gameplay entities sit on the Z = 0 plane. */
const GAMEPLAY_Z = 0

/** Keeps foot/ledge probes just inside the tile they are meant to sample. */
const PROBE_EPS = 1e-4

const DEG = Math.PI / 180

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
 * The dome's profile in world units, authored bottom-to-top: the rim, then up the
 * quarter-ellipse to the apex. The direction is not a style choice — THREE derives lathe
 * normals from the profile's direction of travel, so a top-to-bottom profile renders the
 * cap inside-out.
 *
 * The profile deliberately STOPS at the rim rather than running on to the axis to close
 * the underside. THREE averages a lathe's adjoining segment normals weighted by segment
 * length (and banks the running normal before normalising it), so a flat underside run
 * sharing this vertex ring would outvote the dome's first short step seven to one and
 * leave the rim facing down — a black band around the cap's widest, most visible point.
 * `capUnderside` closes it with a separate disc instead, which keeps the rim a hard edge.
 */
function capProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = []

  for (let step = 0; step <= CAP_PROFILE_STEPS; step += 1) {
    const t = (Math.PI / 2) * (step / CAP_PROFILE_STEPS)
    points.push(
      new THREE.Vector2(
        CAP_RADIUS * Math.cos(t) * TILE_SIZE,
        (CAP_RIM_Y + CAP_HEIGHT * Math.sin(t)) * TILE_SIZE,
      ),
    )
  }

  return points
}

/**
 * The disc that closes the bell, facing straight down. It carries the cap's own colour, so
 * it stays part of the cap rather than reading as a fourth part, and it is cut with the
 * same segment count as the dome so their rims land on identical angles and no sliver can
 * open between them.
 */
function capUnderside(): THREE.BufferGeometry {
  const disc = new THREE.CircleGeometry(CAP_RADIUS * TILE_SIZE, CAP_RADIAL_SEGMENTS)
  // A circle faces +Z; a quarter turn about X lays it flat and points it at the floor.
  disc.rotateX(Math.PI / 2)
  disc.translate(0, CAP_RIM_Y * TILE_SIZE, 0)
  return disc
}

/**
 * One spot, laid on the cap's surface and lifted clear of it. The cap is a squashed
 * ellipsoid, so its outward normal is NOT the radial direction; taking the real gradient
 * is what keeps a flat disc hugging the dome instead of skewing off its shoulder.
 */
function createSpotGeometry(spot: CapSpot): THREE.BufferGeometry {
  const azimuth = spot.azimuth * DEG
  const polar = spot.polar * DEG
  // Azimuth 0 faces +Z, matching LatheGeometry's own convention for the cap beneath.
  const ring = CAP_RADIUS * Math.sin(polar)
  const surface = new THREE.Vector3(
    ring * Math.sin(azimuth),
    CAP_RIM_Y + CAP_HEIGHT * Math.cos(polar),
    ring * Math.cos(azimuth),
  )

  // Gradient of (x/R)^2 + ((y - rim)/H)^2 + (z/R)^2 = 1 at that point.
  const normal = new THREE.Vector3(
    surface.x / (CAP_RADIUS * CAP_RADIUS),
    (surface.y - CAP_RIM_Y) / (CAP_HEIGHT * CAP_HEIGHT),
    surface.z / (CAP_RADIUS * CAP_RADIUS),
  ).normalize()

  const disc = new THREE.CircleGeometry(spot.radius * TILE_SIZE, SPOT_SEGMENTS)
  // A circle faces +Z, so turning +Z onto the normal lays it flat against the cap.
  disc.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal),
  )
  disc.translate(
    (surface.x + normal.x * SPOT_LIFT) * TILE_SIZE,
    (surface.y + normal.y * SPOT_LIFT) * TILE_SIZE,
    (surface.z + normal.z * SPOT_LIFT) * TILE_SIZE,
  )
  paint(disc, WALKER_SPOT_COLOR)
  return disc
}

/**
 * A spotted bell cap over a tapered stem, merged into ONE geometry: main.ts disposes
 * walker.mesh.geometry and walker.mesh.material directly, so child meshes or a material
 * array would leak. mergeGeometries keeps useGroups false for the same reason — groups
 * would demand a material array.
 */
function createMushroomGeometry(): THREE.BufferGeometry {
  const dome = new THREE.LatheGeometry(capProfile(), CAP_RADIAL_SEGMENTS)
  const underside = capUnderside()
  paint(dome, WALKER_CAP_COLOR)
  paint(underside, WALKER_CAP_COLOR)

  // The foot is pinned to the tile's floor; the top runs past the rim by NECK_OVERLAP, far
  // enough inside the dome (still 0.456 tiles wide at that height) that no seam can open.
  const footY = -MESH_SPAN / 2
  const topY = CAP_RIM_Y + NECK_OVERLAP
  const stem = new THREE.CylinderGeometry(
    STEM_TOP_RADIUS * TILE_SIZE,
    STEM_FOOT_RADIUS * TILE_SIZE,
    (topY - footY) * TILE_SIZE,
    STEM_RADIAL_SEGMENTS,
  )
  stem.translate(0, ((topY + footY) / 2) * TILE_SIZE, 0)
  paint(stem, WALKER_STEM_COLOR)

  const parts = [dome, underside, stem, ...CAP_SPOTS.map(createSpotGeometry)]

  // Typed non-null, but the implementation returns null when attribute sets disagree —
  // fail here rather than handing main.ts a null geometry to dispose().
  const merged = mergeGeometries(parts)
  if (merged === null) throw new Error('walker: mushroom part attributes are incompatible')

  // Only the merged geometry is reachable from main.ts, so free the sources here.
  for (const part of parts) part.dispose()
  return merged
}

export class Walker implements Body {
  readonly id: number
  readonly aabb: Aabb
  readonly velocity: Vec2
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>
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
      createMushroomGeometry(),
      // Left white: Lambert multiplies material.color by the vertex colour, so any tint
      // here would darken the cap, the stem and the spots together.
      new THREE.MeshLambertMaterial({ vertexColors: true }),
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

  /**
   * Would the tile ahead of the leading foot still support the walker?
   * Lookahead is at least one tile (not just this step's dt) so a 1-1 walker
   * walking left into the pit at tx 10-11 turns on the last solid tile instead
   * of reaching the rim — and a large dt cannot skip the empty cells.
   */
  private hasGroundAhead(dt: number, grid: TileGrid): boolean {
    const leadX =
      this.dir > 0 ? this.aabb.x + this.aabb.w - PROBE_EPS : this.aabb.x + PROBE_EPS
    const look = Math.max(Math.abs(WALKER_PATROL_SPEED * dt), 1 - PROBE_EPS)
    const footX = leadX + this.dir * look
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
