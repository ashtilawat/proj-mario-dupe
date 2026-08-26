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

/** A line for every World 1 level. */
export type FlagLines = Readonly<Record<World1LevelId, string>>

/** Play order. Keep in sync with the keys of {@link flagLines}. */
export const WORLD_1_LEVEL_IDS = [
  '1-1',
  '1-2',
  '1-3',
  '1-4',
  '1-5',
  '1-6',
  '1-castle',
] as const satisfies readonly World1LevelId[]

/**
 * Shown when the player touches a level's flag. The arc runs across the hills,
 * past the wobblers, and up to the castle to bring the lantern home.
 */
export const flagLines: FlagLines = {
  '1-1': 'First hill down! The sky waves you on.',
  '1-2': 'You out-hopped the wobblers. Nice feet!',
  '1-3': 'Out of the dark, and the lanterns stayed lit.',
  '1-4': 'Over the creek, and not one wet sock!',
  '1-5': 'Up where the clouds nap. Keep climbing!',
  '1-6': 'The castle gate is just past these trees.',
  '1-castle': 'The lantern is home. World 2 is waking up.',
}
