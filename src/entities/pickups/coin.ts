// T-024 — M0 coin pickup: the first collectible.
//
// Units mirror the walker (src/entities/enemies/walker.ts): the hitbox is a 2D AABB in TILE
// space (1 tile = 1.0, bottom-left origin, Y up), while the art lives in WORLD units, where
// TILE_SIZE world units make one tile. Coins never move, so there is no step().

import * as THREE from 'three'
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

/** Saturated gold, deliberately brighter than the player's muted 0xe8c547. */
export const COIN_COLOR = 0xffd400

/** Segment count for the disc — round enough at gameplay scale without wasting verts. */
const COIN_SEGMENTS = 24

/** Gameplay entities sit on the Z = 0 plane. */
const GAMEPLAY_Z = 0

export class Coin {
  readonly id: number
  readonly aabb: Aabb
  readonly mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshLambertMaterial>
  collected = false

  constructor(spawn: CoinSpawn) {
    this.id = spawn.id ?? 0
    this.aabb = { x: spawn.x, y: spawn.y, w: COIN_WIDTH, h: COIN_HEIGHT }
    this.mesh = new THREE.Mesh(
      new THREE.CircleGeometry((COIN_WIDTH * TILE_SIZE) / 2, COIN_SEGMENTS),
      new THREE.MeshLambertMaterial({ color: COIN_COLOR }),
    )
    // Coins never move, so this is the only sync the mesh ever needs. Lambert, like the
    // walker, so it responds to the scene's directional and hemisphere lights.
    this.mesh.position.set(
      (this.aabb.x + this.aabb.w / 2) * TILE_SIZE,
      (this.aabb.y + this.aabb.h / 2) * TILE_SIZE,
      GAMEPLAY_Z,
    )
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
