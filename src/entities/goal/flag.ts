// T-039 — art for the level exit. Flags have been playable since the level chain landed,
// but only as hitboxes: `createFlags` in main.ts read the `flag` entities into AABBs and
// nothing ever drew them, so the goal tile was invisible.
//
// Units mirror the coin (src/entities/pickups/coin.ts): the hitbox is a 2D AABB in TILE
// space (1 tile = 1.0, bottom-left origin, Y up), while the art lives in WORLD units, where
// TILE_SIZE world units make one tile. Flags never move, so there is no step().
//
// The art is deliberately decoupled from the hitbox, the way the boss stand-in's is: the
// pole stands three tiles clear of a one-tile box. Touching any part of the flag tile takes
// the exit, exactly as it did before this file existed — nothing here is collidable.

import * as THREE from 'three'
import { TILE_SIZE } from '../../physics/index.ts'
import type { Aabb } from '../../physics/index.ts'
import { GAMEPLAY_Z } from '../../render/index.ts'

/** Spawn description, matching a level entity's `at`. */
export interface FlagSpawn {
  x: number
  y: number
  id?: number
}

/** Hitbox size in tiles. One tile square, the walker convention `createFlags` reads with. */
export const FLAG_WIDTH = 1
export const FLAG_HEIGHT = 1

/** Pole size in tiles. Tall enough to clear the tallest World 1 terrain the exit sits in. */
export const POLE_WIDTH = 0.16
export const POLE_DEPTH = 0.16
export const POLE_HEIGHT = 3.25

/** Banner size in tiles, and how far below the pole top it hangs. */
export const BANNER_WIDTH = 1.15
export const BANNER_HEIGHT = 0.75
export const BANNER_DROP = 0.25

/**
 * T-057 — how the pennant waves. Spans across the pennant, from the pole edge out to the
 * tip: a triangle drawn as three vertices can only tilt as a rigid plane, so the cloth is
 * cut into columns the wave can bend between.
 */
export const BANNER_SEGMENTS = 12

/**
 * Ripple depth in tiles, at the tip, where the wave is strongest. Deliberately a fraction
 * of the pennant's own drop: this is a paper flag catching a draught, not a windsock.
 */
export const BANNER_WAVE_AMPLITUDE = 0.06

/** Seconds per flap, and how many crests are on the cloth at once. */
export const BANNER_WAVE_PERIOD = 1.1
export const BANNER_WAVE_CRESTS = 1.5

/** Pale steel, so the pole reads against both the sky and the castle theme's dark tiles. */
export const POLE_COLOR = 0xd8dee6

/** Signal red. Deliberately nothing like the coin's 0xffd400: the exit is not a pickup. */
export const BANNER_COLOR = 0xe2453b

/**
 * A drawn level exit. `aabb` is an anchor for the art, not a hitbox: main.ts's `createFlags`
 * owns the box the run loop collides against, and `createFlagArt` builds these FROM that
 * box, so nothing here is ever collided against.
 */
export class Flag {
  readonly id: number
  readonly aabb: Aabb
  /** Parent for the two pieces, parked on the flag tile's bottom-left corner. */
  readonly mesh: THREE.Group
  readonly pole: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>
  readonly banner: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>
  /** The flat pennant, kept so every frame bends the cloth from rest, never from itself. */
  readonly #rest: Float32Array

  constructor(spawn: FlagSpawn) {
    this.id = spawn.id ?? 0
    this.aabb = { x: spawn.x, y: spawn.y, w: FLAG_WIDTH, h: FLAG_HEIGHT }

    // Lambert, like the walker and the coin, so the flag responds to the scene's
    // directional and hemisphere lights instead of reading as a flat sticker.
    this.pole = new THREE.Mesh(
      new THREE.BoxGeometry(
        POLE_WIDTH * TILE_SIZE,
        POLE_HEIGHT * TILE_SIZE,
        POLE_DEPTH * TILE_SIZE,
      ),
      new THREE.MeshLambertMaterial({ color: POLE_COLOR }),
    )
    // Half a pole up from the tile's bottom edge: the art rises out of the ground rather
    // than sinking half of itself into the tile the level author placed.
    this.pole.position.set(
      (FLAG_WIDTH / 2) * TILE_SIZE,
      (POLE_HEIGHT * TILE_SIZE) / 2,
      GAMEPLAY_Z,
    )

    this.banner = new THREE.Mesh(bannerShape(), new THREE.MeshLambertMaterial({
      color: BANNER_COLOR,
      // The pennant is a single flat face. Double-sided so it survives any later camera or
      // parent flip — and so the wave can crest away from the light without going black.
      side: THREE.DoubleSide,
    }))
    // Flush against the pole's -X face, hung just below the top, and pulled forward to the
    // front of the pole so the two never z-fight where they meet. It flies back the way the
    // player came rather than downstream: `followPlayer` clamps the camera to the level's
    // right edge, and 1-castle's flag stands one tile short of it — a downstream pennant
    // would be sliced in half there.
    this.banner.position.set(
      this.pole.position.x - (POLE_WIDTH * TILE_SIZE) / 2,
      (POLE_HEIGHT - BANNER_DROP) * TILE_SIZE,
      (POLE_DEPTH / 2) * TILE_SIZE,
    )

    // The wave rides on the render, not on the run loop: main.ts reads flags as hitboxes
    // and never calls a step on this class, so a step here would simply never be invoked.
    // `onBeforeRender` is three.js's own per-frame hook and lives on the mesh, which means
    // it stops the moment `dispose` unparents the group — no listener to unregister.
    this.#rest = Float32Array.from(
      (this.banner.geometry.getAttribute('position') as THREE.BufferAttribute).array,
    )
    this.banner.onBeforeRender = () => {
      waveBanner(this.banner.geometry, this.#rest, performance.now())
    }

    this.mesh = new THREE.Group()
    this.mesh.name = 'flag'
    this.mesh.add(this.pole, this.banner)
    this.mesh.position.set(this.aabb.x * TILE_SIZE, this.aabb.y * TILE_SIZE, GAMEPLAY_Z)
  }

  /**
   * Free both pieces. Flags are rebuilt wholesale on every level load, so this is what
   * keeps a run through World 1 from leaking seven poles' worth of GPU buffers.
   */
  dispose(): void {
    this.pole.geometry.dispose()
    this.pole.material.dispose()
    this.banner.geometry.dispose()
    this.banner.material.dispose()
    this.mesh.removeFromParent()
  }
}

/**
 * The pennant: a triangle hanging from its top-right corner, tapering to a point back over
 * the ground the player just crossed. Local origin is that corner, so the caller positions
 * it by where it attaches.
 *
 * Built by hand rather than from a `Shape`, for one reason: `ShapeGeometry` triangulates
 * the outline into three vertices, and three vertices cannot ripple. This walks the same
 * three corners in `BANNER_SEGMENTS` columns, so `waveBanner` has spans to bend.
 */
function bannerShape(): THREE.BufferGeometry {
  const width = BANNER_WIDTH * TILE_SIZE
  const height = BANNER_HEIGHT * TILE_SIZE
  const position: number[] = []
  const index: number[] = []

  // Columns from the pole edge outward. Both long edges close on the tip as `t` runs out,
  // so the outline is the shipped triangle to the last decimal.
  for (let i = 0; i < BANNER_SEGMENTS; i += 1) {
    const t = i / BANNER_SEGMENTS
    position.push(-t * width, (-t * height) / 2, 0)
    position.push(-t * width, -height + (t * height) / 2, 0)
  }
  // The tip is one vertex, not two: a doubled point would leave a zero-area triangle, and
  // `computeVertexNormals` normalizes that to NaN and blacks the pennant out.
  const tip = BANNER_SEGMENTS * 2
  position.push(-width, -height / 2, 0)

  for (let i = 0; i < BANNER_SEGMENTS - 1; i += 1) {
    const top = i * 2
    const bottom = top + 1
    const nextTop = top + 2
    const nextBottom = top + 3
    index.push(top, nextTop, nextBottom, top, nextBottom, bottom)
  }
  index.push((BANNER_SEGMENTS - 1) * 2, tip, (BANNER_SEGMENTS - 1) * 2 + 1)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Bend the cloth for one frame. A sine runs out along the pennant, pinned to nothing at
 * the pole edge and free at the tip: the falloff is the distance from the pole, so the
 * attached edge is exactly still and the tip swings the full amplitude.
 *
 * The displacement is depth-only, which keeps the outline — and so the "stays inside its
 * tile column" contract the art was built to — true on every frame, not just at rest. The
 * game's camera is orthographic and looks straight down -Z, so depth alone moves nothing
 * on screen; the normals are what carry the wave, as light sliding across the paper.
 */
function waveBanner(
  geometry: THREE.BufferGeometry,
  rest: Float32Array,
  nowMs: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const width = BANNER_WIDTH * TILE_SIZE
  const phase = (nowMs / 1000 / BANNER_WAVE_PERIOD) * Math.PI * 2

  for (let i = 0; i < position.count; i += 1) {
    // Rest X, never the live one: the wave reads its own input, so a long session cannot
    // drift the pennant off its pole one frame at a time.
    const reach = -rest[i * 3]! / width
    position.setZ(
      i,
      reach * BANNER_WAVE_AMPLITUDE * TILE_SIZE
        * Math.sin(reach * BANNER_WAVE_CRESTS * Math.PI * 2 - phase),
    )
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.getAttribute('normal').needsUpdate = true
}

/** Factory taking a level spawn point. */
export function createFlag(spawn: FlagSpawn): Flag {
  return new Flag(spawn)
}
