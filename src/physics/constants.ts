// PRD 4.2 starting values. Lengths are in TILES, times in seconds.
// These are tuning starting points, not final numbers.

/** World/render units per tile. Physics is tile space; this is the conversion factor. */
export const TILE_SIZE = 16

/** Physics is designed for a 120 Hz fixed step. The loop that drives it is T-002. */
export const FIXED_DT = 1 / 120

/** Downward acceleration, tiles/s^2. Applied by callers; the sweep never adds it. */
export const GRAVITY = 60.0
/** Upward launch speed of a jump, tiles/s. */
export const JUMP_VELOCITY = 23.0
/** Fraction of upward velocity kept when the jump button is released early. 0.25 clips a tap so the arc is clearly shorter than a full hold. */
export const JUMP_CUTOFF_FACTOR = 0.25

/** Max horizontal walk speed, tiles/s. */
export const WALK_MAX = 6.0
/** Max horizontal dash speed, tiles/s. 9.6 / WALK_MAX 6.0 is the spec 1.6x. */
export const DASH_MAX = 9.6
/** Horizontal acceleration while grounded, tiles/s^2. */
export const GROUND_ACCEL = 30
/** Horizontal deceleration while grounded with no input, tiles/s^2. */
export const GROUND_FRICTION = 40
/** Horizontal acceleration while airborne, tiles/s^2. */
export const AIR_ACCEL = 18
/** Horizontal deceleration while airborne with no input, tiles/s^2. */
export const AIR_DRAG = 4
/** Max fall speed, tiles/s. */
export const TERMINAL_VELOCITY = 26
/** Upward velocity granted by stomping an enemy, tiles/s. */
export const STOMP_BOUNCE = 15
/** Max fall speed while wall-sliding, tiles/s. */
export const WALL_SLIDE_MAX_FALL = 6

/** Grace period after walking off a ledge during which a jump still counts, seconds. */
export const COYOTE_TIME_S = 0.1
/** How long an early jump press stays armed waiting for a landing, seconds. */
export const JUMP_BUFFER_S = 0.12
