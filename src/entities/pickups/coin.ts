// T-024 — M0 coin pickup: the first collectible.
//
// Units mirror the walker (src/entities/enemies/walker.ts): the hitbox is a 2D AABB in TILE
// space (1 tile = 1.0, bottom-left origin, Y up), while the art lives in WORLD units, where
// TILE_SIZE world units make one tile. A coin's hitbox never moves; only the art does, so
// step() (T-040) is purely cosmetic and the AABB is set once, in the constructor.
//
// T-059 restyles the disc as a stamped paper coin — rim, face and centre stamp — in the same
// paper-cut language as the player (T-033), walker (T-030) and boss (T-050): flat-coloured
// parts merged into ONE BufferGeometry, drawn by ONE vertex-coloured MeshLambertMaterial.
// The art change stops at the mesh: the AABB, collect() and step() are untouched.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TILE_SIZE } from '../../physics/index.ts'
import type { Aabb } from '../../physics/index.ts'

/** Spawn description, matching a level entity's `at`. */
export interface CoinSpawn {
  x: number
  y: number
  id?: number
}

/** Hitbox size in tiles. One tile square, like the walker. */
export const COIN_WIDTH = 1
export const COIN_HEIGHT = 1

/** Saturated gold, deliberately brighter than the player's muted 0xe8c547. The face. */
export const COIN_COLOR = 0xffd400

/**
 * The two darker golds either side of the face: a shaded rim band, and a centre stamp dark
 * enough to read as a struck mark rather than a third ring. Local to the coin, so the shared
 * palette in constants.ts stays about the world rather than about one pickup.
 */
const COIN_RIM_COLOR = 0xc98a12
const COIN_STAMP_COLOR = 0x8a5a08

/**
 * Part radii as fractions of the disc: an 18% rim band and a centre mark just over a quarter
 * of the radius. Both are wide enough to survive at gameplay scale, and the face still takes
 * the largest share so the coin reads as gold rather than as a target.
 */
const COIN_FACE_RATIO = 0.82
const COIN_STAMP_RATIO = 0.28

/** Segment count for the disc — round enough at gameplay scale without wasting verts. */
const COIN_SEGMENTS = 24

/** Gameplay entities sit on the Z = 0 plane. */
const GAMEPLAY_Z = 0

/** One whole revolution, in radians — the wrap point for the spin angle. */
const FULL_TURN = Math.PI * 2

/** T-040 — idle spin rate in radians/s: exactly one revolution per second. */
export const COIN_SPIN_SPEED = FULL_TURN

/** Flat-fill a geometry's vertices so the merged disc keeps its parts distinguishable. */
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
 * Rim, face and stamp, merged into ONE geometry: main.ts disposes coin.mesh.geometry and
 * coin.mesh.material directly, so child meshes or a material array would leak. mergeGeometries
 * keeps useGroups false for the same reason — groups would demand a material array.
 *
 * The three parts are concentric annuli that tile the disc exactly: each part's inner radius
 * is the next one's outer radius, so nothing overlaps and every part can stay at z = 0. That
 * is what keeps the coin genuinely paper-thin — stacking a solid face over a rim would need
 * Z offsets to dodge z-fighting, and a layered coin would not read edge-on when it spins.
 */
function createCoinGeometry(): THREE.BufferGeometry {
  const discRadius = (COIN_WIDTH * TILE_SIZE) / 2
  const faceRadius = discRadius * COIN_FACE_RATIO
  const stampRadius = discRadius * COIN_STAMP_RATIO

  const rim = new THREE.RingGeometry(faceRadius, discRadius, COIN_SEGMENTS)
  paint(rim, COIN_RIM_COLOR)

  const face = new THREE.RingGeometry(stampRadius, faceRadius, COIN_SEGMENTS)
  paint(face, COIN_COLOR)

  const stamp = new THREE.CircleGeometry(stampRadius, COIN_SEGMENTS)
  paint(stamp, COIN_STAMP_COLOR)

  // Typed non-null, but the implementation returns null when attribute sets disagree — fail
  // here rather than handing main.ts a null geometry to dispose().
  const merged = mergeGeometries([rim, face, stamp])
  if (merged === null) throw new Error('coin: rim, face and stamp attributes are incompatible')

  // Only the merged geometry is reachable from main.ts, so free the sources here.
  rim.dispose()
  face.dispose()
  stamp.dispose()
  return merged
}

export class Coin {
  readonly id: number
  readonly aabb: Aabb
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>
  collected = false

  constructor(spawn: CoinSpawn) {
    this.id = spawn.id ?? 0
    this.aabb = { x: spawn.x, y: spawn.y, w: COIN_WIDTH, h: COIN_HEIGHT }
    this.mesh = new THREE.Mesh(
      createCoinGeometry(),
      // Left white: Lambert multiplies material.color by the vertex colour, so any tint here
      // would darken the rim, the face and the stamp alike.
      //
      // DoubleSide because the disc is flat and spins: past a quarter turn its front face
      // points away from the camera, and a single-sided coin would blink out for half of
      // every revolution.
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    )
    // The hitbox never moves, so this is the only position sync the mesh ever needs; step()
    // touches rotation alone. Lambert, like the walker, so it responds to the scene's
    // directional and hemisphere lights.
    this.mesh.position.set(
      (this.aabb.x + this.aabb.w / 2) * TILE_SIZE,
      (this.aabb.y + this.aabb.h / 2) * TILE_SIZE,
      GAMEPLAY_Z,
    )
  }

  /**
   * Advance the idle spin. The disc sits in XY facing +Z, so turning it about Y spins it on
   * its vertical diameter — the classic standing-coin spin, edge-on twice a revolution.
   *
   * Cosmetic only: this writes rotation.y and nothing else, so a spinning coin's hitbox and
   * overlap answers are identical to a still one's. A collected coin is already hidden, so
   * it stops where it stopped rather than spinning on invisibly.
   */
  step(dt: number): void {
    if (this.collected) return
    this.mesh.rotation.y = (this.mesh.rotation.y + COIN_SPIN_SPEED * dt) % FULL_TURN
  }

  /**
   * Take this coin. Hiding the disc is idempotent; the return value is not, so a caller can
   * score exactly once however many frames the overlap lasts.
   *
   * @returns true only on the call that collected it.
   */
  collect(): boolean {
    if (this.collected) return false
    this.collected = true
    this.mesh.visible = false
    return true
  }
}

/** Factory taking a level spawn point. */
export function createCoin(spawn: CoinSpawn): Coin {
  return new Coin(spawn)
}
