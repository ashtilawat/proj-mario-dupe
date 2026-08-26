/**
 * T-052. Taking a flag no longer advances the run on the touch frame: the level's story line
 * goes up and holds the run frozen for FLAG_TOAST_S of simulated time, and only when that
 * beat runs out does the swap happen. Every test that walks the run forward by taking flags
 * has to sit through it, so this is the one place that knows how long it is.
 *
 * Not a `.test.ts` file on purpose: vitest collects `tests/**\/*.test.ts`, so this is a
 * helper rather than an empty suite.
 */
import { FIXED_DT } from '../../src/engine/index.ts'
import { FLAG_TOAST_S } from '../../src/main'
import type { Game } from '../../src/main'

/** The most fixed steps the beat can take, with room to spare for the one it ends on. */
const MAX_STEPS = Math.ceil(FLAG_TOAST_S / FIXED_DT) + 2

/**
 * Runs the toast's beat out one fixed step at a time and stops the moment the line comes
 * down — so the run is left on the very step that advanced it, and not one live step past
 * it. That matters: an overshoot would step the walkers of the level just loaded, and the
 * assertions on the far side of a flag are written against their spawns.
 *
 * A run with no toast up returns untouched, which is what a level with no line looks like.
 */
export function elapseFlagToast(game: Game, root: ParentNode = document): void {
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const toast = root.querySelector<HTMLElement>('[data-flag-toast]')
    if (!toast || toast.style.display === 'none') return
    game.loop.tick(FIXED_DT)
  }
  throw new Error('the flag toast never came down')
}
