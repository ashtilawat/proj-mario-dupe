// Core physics types. Everything here is in TILE SPACE: one tile is 1.0 unit wide and
// 1.0 unit tall, and tile (tx, ty) covers x in [tx, tx + 1) and y in [ty, ty + 1).
// The axes are three.js XY with Y up, so "down" is negative Y (vy < 0).
// TILE_SIZE converts tile space to world/render units; physics never uses it.

/** A 2D vector in tile space. */
export interface Vec2 {
  x: number
  y: number
}

/**
 * An axis-aligned bounding box in tile space, anchored at its bottom-left corner.
 * These hitboxes are deliberately decoupled from any 3D model bounds.
 */
export interface Aabb {
  /** Left edge. */
  x: number
  /** Bottom edge (Y-up). */
  y: number
  /** Width, extends towards +X. */
  w: number
  /** Height, extends towards +Y. */
  h: number
}

/** What a tilemap cell does to a sweeping AABB. */
export type TileKind = 'empty' | 'solid' | 'oneWay'

/**
 * The minimal tilemap contract the physics module needs. src/levels owns the real
 * implementation; tests can stub this with a plain object.
 */
export interface TileGrid {
  /** Number of tile columns. */
  readonly width: number
  /** Number of tile rows. */
  readonly height: number
  /** World units per tile, for renderers. Physics works in tile space and ignores this. */
  readonly tileSize: number
  getTile(tx: number, ty: number): TileKind
}

/** A moving entity: a hitbox plus a velocity in tiles/second. */
export interface Body {
  aabb: Aabb
  velocity: Vec2
}

/** Outcome of a swept move, in tile space. */
export interface SweepResult {
  /** Resolved left edge. */
  x: number
  /** Resolved bottom edge. */
  y: number
  /** True when the X sweep was stopped by a solid tile. */
  hitX: boolean
  /** True when the Y sweep was stopped by a solid or active one-way tile. */
  hitY: boolean
  /** True when the Y sweep was stopped while moving down, i.e. the body landed. */
  grounded: boolean
}
