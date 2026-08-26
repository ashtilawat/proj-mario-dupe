import type { Aabb } from './types.ts'

export const left = (a: Aabb): number => a.x
export const right = (a: Aabb): number => a.x + a.w
export const bottom = (a: Aabb): number => a.y
export const top = (a: Aabb): number => a.y + a.h

/** Touching edges do not count as an overlap — that is what keeps bodies unstuck. */
export function overlaps(a: Aabb, b: Aabb): boolean {
  return right(a) > left(b) && left(a) < right(b) && top(a) > bottom(b) && bottom(a) < top(b)
}
