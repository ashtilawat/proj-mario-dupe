/**
 * Fixed-timestep game loop with render interpolation.
 *
 * The simulation always advances in {@link FIXED_DT} increments so physics is
 * frame-rate independent and deterministic; whatever time is left over becomes the
 * `alpha` handed to `render`, for interpolating between the last two simulated states.
 *
 * `tick` takes a raw frame delta, so the whole loop is drivable from a test without
 * requestAnimationFrame. No three.js here — the engine knows nothing about rendering.
 */
import { createInput, type Input, type InputState } from './input'

/** The simulation step: 120 Hz. */
export const FIXED_DT = 1 / 120

/**
 * Longest frame delta the loop will honour. A stalled tab reports a huge delta; without
 * this cap the catch-up `while` would run thousands of steps and stall even harder.
 * Time beyond the cap is dropped — the simulation runs slow rather than freezing.
 */
export const MAX_FRAME_DELTA = 0.25

export interface LoopOptions {
  /** Advances the world by exactly `dt` seconds. `input` is the same object every call. */
  simulate: (dt: number, input: InputState) => void
  /** Draws a frame. `alpha` in [0, 1) is how far past the last simulated state we are. */
  render: (alpha: number) => void
  /** Input source. Defaults to a detached {@link createInput}. */
  input?: Input
  /** Frame scheduler used by `start`. Defaults to `requestAnimationFrame`. */
  requestFrame?: (callback: (time: number) => void) => number
  /** Cancels a handle from `requestFrame`. Defaults to `cancelAnimationFrame`. */
  cancelFrame?: (handle: number) => void
}

export interface Loop {
  /** Unsimulated time carried into the next frame, in seconds. Always < FIXED_DT. */
  readonly accumulator: number
  readonly running: boolean
  /** Runs one frame's worth of simulation and a render. `frameDelta` is in seconds. */
  tick(frameDelta: number): void
  start(): void
  stop(): void
}

const defaultRequestFrame = (callback: (time: number) => void): number =>
  globalThis.requestAnimationFrame(callback)

const defaultCancelFrame = (handle: number): void => globalThis.cancelAnimationFrame(handle)

export function createLoop(options: LoopOptions): Loop {
  const { simulate, render } = options
  const input = options.input ?? createInput()
  const requestFrame = options.requestFrame ?? defaultRequestFrame
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame

  let accumulator = 0
  let running = false
  let handle = 0
  let lastTime = 0
  let hasLastTime = false

  function tick(frameDelta: number): void {
    const state = input.poll()

    accumulator += Math.min(frameDelta, MAX_FRAME_DELTA)
    while (accumulator >= FIXED_DT) {
      simulate(FIXED_DT, state)
      accumulator -= FIXED_DT
    }
    render(accumulator / FIXED_DT)
  }

  // Declared once; `start` re-schedules the same reference every frame.
  const frame = (time: number): void => {
    if (!running) return
    // The first frame only establishes a baseline — there is no elapsed time yet.
    const frameDelta = hasLastTime ? (time - lastTime) / 1000 : 0
    lastTime = time
    hasLastTime = true
    tick(frameDelta)
    handle = requestFrame(frame)
  }

  function start(): void {
    if (running) return
    running = true
    hasLastTime = false
    handle = requestFrame(frame)
  }

  function stop(): void {
    if (!running) return
    running = false
    hasLastTime = false
    cancelFrame(handle)
  }

  return {
    get accumulator() {
      return accumulator
    },
    get running() {
      return running
    },
    tick,
    start,
    stop,
  }
}
