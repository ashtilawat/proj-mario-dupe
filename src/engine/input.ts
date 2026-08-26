/**
 * Keyboard + Gamepad input, merged into a single long-lived {@link InputState}.
 *
 * Nothing here allocates once `createInput` has returned: held keys live in a bitmask,
 * the state object is written in place, and `poll()` hands back the same reference every
 * frame so the simulation never sees a fresh object.
 */

/** The merged input snapshot. Mutated in place — never copy the reference expecting a value. */
export interface InputState {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  jump: boolean
  /** Horizontal intent in [-1, 1]. Analog when a stick is pushed, otherwise digital. */
  moveX: number
}

export interface InputOptions {
  /** Overrides the Gamepad API lookup. Defaults to `navigator.getGamepads()`. */
  getGamepads?: () => ArrayLike<Gamepad | null>
}

export interface Input {
  /** The single reused state object. Same reference as `poll()` returns. */
  readonly state: InputState
  /** Refreshes `state` from the keyboard bitmask and the connected gamepads. */
  poll(): InputState
  /** Starts listening for key events on `target`. Detaches any previous target first. */
  attach(target: EventTarget): void
  /** Stops listening and clears held keys, so a lost focus cannot stick a direction on. */
  detach(): void
}

/** Below this magnitude a stick reading is treated as drift, not intent. */
export const STICK_DEAD_ZONE = 0.25

// One bit per physical key, not per action: holding ArrowLeft and KeyA together and
// releasing one must leave `left` held.
const KEY_A = 1 << 0
const KEY_ARROW_LEFT = 1 << 1
const KEY_D = 1 << 2
const KEY_ARROW_RIGHT = 1 << 3
const KEY_W = 1 << 4
const KEY_ARROW_UP = 1 << 5
const KEY_S = 1 << 6
const KEY_ARROW_DOWN = 1 << 7
const KEY_SPACE = 1 << 8

const KEY_BITS: Readonly<Record<string, number>> = {
  KeyA: KEY_A,
  ArrowLeft: KEY_ARROW_LEFT,
  KeyD: KEY_D,
  ArrowRight: KEY_ARROW_RIGHT,
  KeyW: KEY_W,
  ArrowUp: KEY_ARROW_UP,
  KeyS: KEY_S,
  ArrowDown: KEY_ARROW_DOWN,
  Space: KEY_SPACE,
}

const LEFT_KEYS = KEY_A | KEY_ARROW_LEFT
const RIGHT_KEYS = KEY_D | KEY_ARROW_RIGHT
const UP_KEYS = KEY_W | KEY_ARROW_UP
const DOWN_KEYS = KEY_S | KEY_ARROW_DOWN
const JUMP_KEYS = KEY_SPACE

// Standard gamepad mapping: https://w3c.github.io/gamepad/#remapping
const PAD_AXIS_X = 0
const PAD_AXIS_Y = 1
const PAD_BUTTON_JUMP = 0
const PAD_DPAD_UP = 12
const PAD_DPAD_DOWN = 13
const PAD_DPAD_LEFT = 14
const PAD_DPAD_RIGHT = 15

/** Shared empty result so the no-gamepad path allocates nothing. */
const NO_GAMEPADS: readonly (Gamepad | null)[] = []

function navigatorGamepads(): ArrayLike<Gamepad | null> {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return NO_GAMEPADS
  }
  return navigator.getGamepads()
}

function isPressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index]
  return button !== undefined && button.pressed
}

export function createInput(options: InputOptions = {}): Input {
  const getGamepads = options.getGamepads ?? navigatorGamepads

  const state: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    moveX: 0,
  }

  let held = 0
  let attached: EventTarget | null = null

  // Bound once at construction so attach/detach pass the same references.
  const onKeyDown = (event: Event): void => {
    const bit = KEY_BITS[(event as KeyboardEvent).code]
    if (bit !== undefined) held |= bit
  }

  const onKeyUp = (event: Event): void => {
    const bit = KEY_BITS[(event as KeyboardEvent).code]
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

  function poll(): InputState {
    let left = (held & LEFT_KEYS) !== 0
    let right = (held & RIGHT_KEYS) !== 0
    let up = (held & UP_KEYS) !== 0
    let down = (held & DOWN_KEYS) !== 0
    let jump = (held & JUMP_KEYS) !== 0
    let analogX = 0

    const pads = getGamepads()
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i]
      if (!pad) continue

      const axisX = pad.axes[PAD_AXIS_X] ?? 0
      const axisY = pad.axes[PAD_AXIS_Y] ?? 0

      if (axisX <= -STICK_DEAD_ZONE) {
        left = true
        analogX = axisX
      } else if (axisX >= STICK_DEAD_ZONE) {
        right = true
        analogX = axisX
      }

      // The standard mapping points the stick's Y axis down.
      if (axisY <= -STICK_DEAD_ZONE) up = true
      else if (axisY >= STICK_DEAD_ZONE) down = true

      if (isPressed(pad, PAD_DPAD_LEFT)) left = true
      if (isPressed(pad, PAD_DPAD_RIGHT)) right = true
      if (isPressed(pad, PAD_DPAD_UP)) up = true
      if (isPressed(pad, PAD_DPAD_DOWN)) down = true
      if (isPressed(pad, PAD_BUTTON_JUMP)) jump = true
    }

    state.left = left
    state.right = right
    state.up = up
    state.down = down
    state.jump = jump
    // A pushed stick wins; otherwise fall back to the digital left/right pair.
    state.moveX = analogX !== 0 ? analogX : (right ? 1 : 0) - (left ? 1 : 0)

    return state
  }

  return { state, poll, attach, detach }
}
