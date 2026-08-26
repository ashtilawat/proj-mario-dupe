/**
 * Player-facing copy for World 1. Pure data: no DOM, no scene, no listeners.
 * Nothing here is wired into the game yet — that is a later ticket.
 */

/** The seven World 1 level ids, in play order. */
export type World1LevelId = '1-1' | '1-2' | '1-3' | '1-4' | '1-5' | '1-6' | '1-castle'

/** The game's name, shown on the title overlay. */
export const title = 'Pip and the Paper Hills'

/** One line under the title. */
export const tagline = 'Hop far. Land soft.'
