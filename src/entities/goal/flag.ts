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
  readonly banner: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshLambertMaterial>

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
      // ShapeGeometry is a single flat face. Double-sided so the pennant survives any later
      // camera or parent flip, for the cost of two extra triangles.
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
 */
function bannerShape(): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(-BANNER_WIDTH * TILE_SIZE, (-BANNER_HEIGHT / 2) * TILE_SIZE)
  shape.lineTo(0, -BANNER_HEIGHT * TILE_SIZE)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

/** Factory taking a level spawn point. */
export function createFlag(spawn: FlagSpawn): Flag {
  return new Flag(spawn)
}
