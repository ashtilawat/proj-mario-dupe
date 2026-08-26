// T-024 — M0 coin pickup: the first collectible.
//
// Units mirror the walker (src/entities/enemies/walker.ts): the hitbox is a 2D AABB in TILE
// space (1 tile = 1.0, bottom-left origin, Y up), while the art lives in WORLD units, where
// TILE_SIZE world units make one tile. Coins never move, so there is no step().

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

export class Coin {
  readonly id: number
  readonly aabb: Aabb
  collected = false

  constructor(spawn: CoinSpawn) {
    this.id = spawn.id ?? 0
    this.aabb = { x: spawn.x, y: spawn.y, w: COIN_WIDTH, h: COIN_HEIGHT }
  }
}

/** Factory taking a level spawn point. */
export function createCoin(spawn: CoinSpawn): Coin {
  return new Coin(spawn)
}
