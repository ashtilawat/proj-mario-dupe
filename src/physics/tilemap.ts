import type { TileGrid } from './types.ts'

/** An inclusive range of tile indices, clamped to the grid. Empty when tx0 > tx1. */
export interface TileRange {
  tx0: number
  tx1: number
  ty0: number
  ty1: number
}

/**
 * Broadphase: the inclusive tile range covering [minX, maxX] x [minY, maxY], clamped to
 * the grid so out-of-bounds cells are never queried. A span ending exactly on a tile
 * boundary does not include the tile beyond it, so a body resting flush against a surface
 * does not keep colliding with it.
 */
export function tileRange(
  grid: TileGrid,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  out: TileRange,
): TileRange {
  out.tx0 = Math.max(0, Math.floor(minX))
  out.tx1 = Math.min(grid.width - 1, Math.ceil(maxX) - 1)
  out.ty0 = Math.max(0, Math.floor(minY))
  out.ty1 = Math.min(grid.height - 1, Math.ceil(maxY) - 1)
  return out
}

/**
 * A one-way platform is solid only while the entity is moving down AND its previous-frame
 * bottom was at or above the platform top. Everything else passes straight through.
 */
export function isOneWaySolid(vy: number, prevBottom: number, platformTop: number): boolean {
  return vy < 0 && prevBottom >= platformTop
}
