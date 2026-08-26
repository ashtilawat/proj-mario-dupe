import type { InputState } from '../../engine/input.ts'
import type { PlayerInput } from './types.ts'

/**
 * Dash lives here, not in the engine: the engine's {@link InputState} is the shared
 * movement contract, and Shift is a player ability. `poll` folds the engine snapshot and
 * the local Shift state into the single {@link PlayerInput} the player entity consumes.
 *
 * Like the engine input, nothing here allocates after construction — `poll` rewrites and
 * returns the same object every frame.
 */
export interface DashInput {
  /** The single reused state object. Same reference as `poll()` returns. */
  readonly state: PlayerInput
  /** Refreshes `state` from `engine` plus the held Shift keys. */
  poll(engine: InputState): PlayerInput
  /** Starts listening for Shift on `target`. Detaches any previous target first. */
  attach(target: EventTarget): void
  /** Stops listening and clears held keys, so lost focus cannot stick dash on. */
  detach(): void
}

// One bit per physical key: holding both Shifts and releasing one must leave dash held.
const SHIFT_LEFT = 1 << 0
const SHIFT_RIGHT = 1 << 1

const SHIFT_BITS: Readonly<Record<string, number>> = {
  ShiftLeft: SHIFT_LEFT,
  ShiftRight: SHIFT_RIGHT,
}

export function createDashInput(): DashInput {
  const state: PlayerInput = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    dash: false,
    moveX: 0,
  }

  let held = 0
  let attached: EventTarget | null = null

  // Bound once at construction so attach/detach pass the same references.
  const onKeyDown = (event: Event): void => {
    const bit = SHIFT_BITS[(event as KeyboardEvent).code]
    if (bit !== undefined) held |= bit
  }

  const onKeyUp = (event: Event): void => {
    const bit = SHIFT_BITS[(event as KeyboardEvent).code]
    if (bit !== undefined) held &= ~bit
  }

  function detach(): void {
    if (attached === null) return
    attached.removeEventListener('keydown', onKeyDown)
    attached.removeEventListener('keyup', onKeyUp)
    attached = null
    held = 0
  }

  function attach(target: EventTarget): void {
    detach()
    target.addEventListener('keydown', onKeyDown)
    target.addEventListener('keyup', onKeyUp)
    attached = target
  }

  function poll(engine: InputState): PlayerInput {
    state.left = engine.left
    state.right = engine.right
    state.up = engine.up
    state.down = engine.down
    state.jump = engine.jump
    state.moveX = engine.moveX
    state.dash = held !== 0
    return state
  }

  return { state, poll, attach, detach }
}
