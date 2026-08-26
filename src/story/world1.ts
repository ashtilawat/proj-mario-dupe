/**
 * Player-facing copy for World 1. Pure data: no DOM, no scene, no listeners.
 * Nothing here is wired into the game yet — that is a later ticket.
 */

/** The seven World 1 level ids, in play order. */
export type World1LevelId = '1-1' | '1-2' | '1-3' | '1-4' | '1-5' | '1-6' | '1-castle'

/** The game's name, shown on the title overlay. */
export const title = 'Pip and the Paper Hills'

/** One line under the title. */
export const tagline = 'Carry the lantern home, one hop at a time.'

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
 * Shown when the player touches a level's flag. Read in play order they tell one
 * story: Pip carries a lantern over the paper hills, through the dark cave at 1-3,
 * back out into the sun, and up past the paper king's gate to bring it home.
 */
export const flagLines: FlagLines = {
  '1-1': 'One hill down, Pip. The lantern is still lit.',
  '1-2': 'Past the wobblers! The paper hills roll on.',
  '1-3': 'Through the dark cave, and the lantern held on.',
  '1-4': 'Back in the sunshine. Shake off that cave dust!',
  '1-5': 'Up where the clouds nap. Castle towers ahead!',
  '1-6': 'The paper king left the gate open. Almost home!',
  '1-castle': 'The lantern is home, Pip. World 2 is waking up.',
}
