import { isOneWaySolid, tileRange } from './tilemap.ts'
import type { TileRange } from './tilemap.ts'
import type { Aabb, Body, SweepResult, TileGrid } from './types.ts'

// Reused across steps so a 120 Hz loop allocates nothing for broadphase.
const scratchRange: TileRange = { tx0: 0, tx1: 0, ty0: 0, ty1: 0 }

// Broadphase skin, applied only along the axis being swept. Without it a sweep that ends
// exactly flush against a surface would not even look at that tile, so a perfectly-timed
// landing would report grounded === false for one frame.
const CONTACT_EPS = 1e-9

function newResult(): SweepResult {
  return { x: 0, y: 0, hitX: false, hitY: false, grounded: false }
}

/**
 * Sweep `aabb` by (dx, dy) tiles against the grid, resolving X first and then Y.
 *
 * Resolving one axis at a time is what stops a body pressed into a wall from catching on
 * the seam between two stacked wall tiles: after the X pass the body sits flush against
 * the wall, so the Y pass's broadphase no longer includes the wall column at all.
 *
 * The input AABB is never mutated. Pass `out` to reuse a result object.
 */
export function sweepAabb(
  aabb: Aabb,
  dx: number,
  dy: number,
  grid: TileGrid,
  out: SweepResult = newResult(),
): SweepResult {
  const { w, h } = aabb
  // The one-way rule keys off where the body was before this step began.
  const prevBottom = aabb.y
  const y = aabb.y
  let x = aabb.x
  let hitX = false
  let hitY = false

  if (dx !== 0) {
    const minX = dx > 0 ? x : x + dx - CONTACT_EPS
    const maxX = dx > 0 ? x + w + dx + CONTACT_EPS : x + w
    const range = tileRange(grid, minX, y, maxX, y + h, scratchRange)
    let bestT = 1
    let contactX = 0
    let hit = false

    for (let ty = range.ty0; ty <= range.ty1; ty += 1) {
      for (let tx = range.tx0; tx <= range.tx1; tx += 1) {
        // One-way platforms never block horizontal movement.
        if (grid.getTile(tx, ty) !== 'solid') continue
        const t = dx > 0 ? (tx - (x + w)) / dx : (tx + 1 - x) / dx
        if (t >= 0 && t <= bestT) {
          bestT = t
          contactX = dx > 0 ? tx - w : tx + 1
          hit = true
        }
      }
    }

    if (hit) {
      // Snap to the contact edge rather than x + dx * t, so no float drift leaks overlap.
      x = contactX
      hitX = true
    } else {
      x += dx
    }
  }

  let resolvedY = y
  if (dy !== 0) {
    const minY = dy > 0 ? y : y + dy - CONTACT_EPS
    const maxY = dy > 0 ? y + h + dy + CONTACT_EPS : y + h
    const range = tileRange(grid, x, minY, x + w, maxY, scratchRange)
    let bestT = 1
    let contactY = 0
    let hit = false

    for (let ty = range.ty0; ty <= range.ty1; ty += 1) {
      for (let tx = range.tx0; tx <= range.tx1; tx += 1) {
        const kind = grid.getTile(tx, ty)
        if (kind === 'empty') continue
        if (kind === 'oneWay' && !isOneWaySolid(dy, prevBottom, ty + 1)) continue
        const t = dy > 0 ? (ty - (y + h)) / dy : (ty + 1 - y) / dy
        if (t >= 0 && t <= bestT) {
          bestT = t
          contactY = dy > 0 ? ty - h : ty + 1
          hit = true
        }
      }
    }

    if (hit) {
      resolvedY = contactY
      hitY = true
    } else {
      resolvedY = y + dy
    }
  }

  out.x = x
  out.y = resolvedY
  out.hitX = hitX
  out.hitY = hitY
  out.grounded = hitY && dy < 0
  return out
}

/**
 * Integrate `body`'s velocity over `dt`, sweep it against the grid and write the resolved
 * position back onto the body. Velocity on an axis that hit something is zeroed.
 *
 * This does not apply gravity — the caller (the entity controller) owns forces, so a body
 * can float, wall-slide or be launched without the collision layer knowing about it.
 */
export function moveAndCollide(
  body: Body,
  dt: number,
  grid: TileGrid,
  out: SweepResult = newResult(),
): SweepResult {
  const result = sweepAabb(body.aabb, body.velocity.x * dt, body.velocity.y * dt, grid, out)

  body.aabb.x = result.x
  body.aabb.y = result.y
  if (result.hitX) body.velocity.x = 0
  if (result.hitY) body.velocity.y = 0

  return result
}
