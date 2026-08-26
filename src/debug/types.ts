/** Axis-aligned box in the XY gameplay plane (Y-up). x,y is the min corner. */
export type Aabb2 = {
  x: number
  y: number
  w: number
  h: number
}

export type Vec2 = {
  x: number
  y: number
}

/** Optional velocity in tiles/s (or world units/s) on the XY plane. */
export type Velocity2 = {
  vx: number
  vy: number
}

export type DebugBody = {
  aabb: Aabb2
  velocity?: Velocity2
}

/** PRD 4.2 feel constants. Speeds/accels are tiles/s unless noted. */
export type Tuning = {
  gravity: number
  jumpVelocity: number
  jumpCutoffFactor: number
  walkMax: number
  dashMax: number
  groundAccel: number
  groundFriction: number
  airAccel: number
  airDrag: number
  terminalVelocity: number
  stompBounce: number
  wallSlideMaxFall: number
  coyoteTimeMs: number
  jumpBufferMs: number
  tileSize: number
}

export type PrdTuning = Tuning

export const TUNING_KEYS = [
  'gravity',
  'jumpVelocity',
  'jumpCutoffFactor',
  'walkMax',
  'dashMax',
  'groundAccel',
  'groundFriction',
  'airAccel',
  'airDrag',
  'terminalVelocity',
  'stompBounce',
  'wallSlideMaxFall',
  'coyoteTimeMs',
  'jumpBufferMs',
  'tileSize',
] as const

export type TuningKey = (typeof TUNING_KEYS)[number]

export const TUNING_LABELS: Record<TuningKey, string> = {
  gravity: 'Gravity (tiles/s²)',
  jumpVelocity: 'Jump velocity (tiles/s)',
  jumpCutoffFactor: 'Jump cutoff factor',
  walkMax: 'Walk max (tiles/s)',
  dashMax: 'Dash max (tiles/s)',
  groundAccel: 'Ground accel (tiles/s²)',
  groundFriction: 'Ground friction (tiles/s²)',
  airAccel: 'Air accel (tiles/s²)',
  airDrag: 'Air drag (tiles/s²)',
  terminalVelocity: 'Terminal velocity (tiles/s)',
  stompBounce: 'Stomp bounce (tiles/s)',
  wallSlideMaxFall: 'Wall-slide max fall (tiles/s)',
  coyoteTimeMs: 'Coyote time (ms)',
  jumpBufferMs: 'Jump buffer (ms)',
  tileSize: 'Tile size (world units)',
}

export const PRD_TUNING_DEFAULTS: Tuning = {
  gravity: 60.0,
  jumpVelocity: 23.0,
  jumpCutoffFactor: 0.45,
  walkMax: 6.0,
  dashMax: 9.6,
  groundAccel: 30,
  groundFriction: 40,
  airAccel: 18,
  airDrag: 4,
  terminalVelocity: 26,
  stompBounce: 15,
  wallSlideMaxFall: 6,
  coyoteTimeMs: 100,
  jumpBufferMs: 120,
  tileSize: 16,
}

export function cloneTuning(tuning: Tuning): Tuning {
  return { ...tuning }
}

export function mergeTuning(base: Tuning, patch?: Partial<Tuning>): Tuning {
  if (!patch) return cloneTuning(base)
  const next = cloneTuning(base)
  for (const key of TUNING_KEYS) {
    const value = patch[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[key] = value
    }
  }
  return next
}
