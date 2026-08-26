import { afterEach, describe, expect, test } from 'vitest'
import {
  FIXED_DT,
  MAX_FRAME_DELTA,
  createInput,
  createLoop,
  type Input,
  type InputState,
  type Loop,
} from '../src/engine'

/** A loop with no gamepads attached, recording everything the callbacks receive. */
function recordingLoop(input: Input = createInput({ getGamepads: () => [] })): {
  loop: Loop
  input: Input
  simulated: InputState[]
  dts: number[]
  alphas: number[]
} {
  const simulated: InputState[] = []
  const dts: number[] = []
  const alphas: number[] = []
  const loop = createLoop({
    input,
    simulate: (dt, state) => {
      dts.push(dt)
      simulated.push(state)
    },
    render: (alpha) => {
      alphas.push(alpha)
    },
  })
  return { loop, input, simulated, dts, alphas }
}

describe('FIXED_DT', () => {
  test('is a 120 Hz time step', () => {
    expect(FIXED_DT).toBe(1 / 120)
  })

  test('frame deltas are clamped at a quarter second', () => {
    expect(MAX_FRAME_DELTA).toBe(0.25)
  })
})

describe('tick', () => {
  test('runs without requestAnimationFrame — a raw delta drives the whole step', () => {
    const { loop, simulated, alphas } = recordingLoop()

    loop.tick(FIXED_DT)

    expect(simulated).toHaveLength(1)
    expect(alphas).toHaveLength(1)
  })

  test('a 1/60 s frame simulates twice at the fixed step, then renders once', () => {
    const { loop, dts, alphas } = recordingLoop()

    loop.tick(1 / 60)

    expect(dts).toEqual([FIXED_DT, FIXED_DT])
    expect(alphas).toHaveLength(1)
  })

  test('a frame shorter than the fixed step simulates nothing but still renders', () => {
    const { loop, simulated, alphas } = recordingLoop()

    loop.tick(FIXED_DT / 2)

    expect(simulated).toHaveLength(0)
    expect(alphas).toEqual([0.5])
  })

  test('leftover time carries into the next frame instead of being dropped', () => {
    const { loop, simulated } = recordingLoop()

    loop.tick(FIXED_DT * 0.6)
    loop.tick(FIXED_DT * 0.6)

    expect(simulated).toHaveLength(1)
  })

  test('a 1 s stall only banks 0.25 s, capping the catch-up simulates', () => {
    const { loop, simulated } = recordingLoop()

    loop.tick(1)

    // Unclamped, 1 s would have run 120 steps. The clamp buys at most 0.25 s of them.
    expect(simulated.length).toBeLessThanOrEqual(Math.floor(MAX_FRAME_DELTA / FIXED_DT))
    expect(simulated.length).toBeGreaterThanOrEqual(29)
  })

  test('the clamp does not let a stall accumulate debt across frames', () => {
    const { loop, simulated } = recordingLoop()

    loop.tick(1)
    const afterStall = simulated.length
    loop.tick(FIXED_DT)

    expect(simulated.length - afterStall).toBe(1)
  })

  test('alpha is the leftover accumulator expressed in fixed steps', () => {
    const { loop, alphas } = recordingLoop()

    loop.tick(FIXED_DT * 2.5)

    expect(alphas).toHaveLength(1)
    expect(alphas[0]).toBeCloseTo(0.5, 10)
  })

  test('alpha equals accumulator / FIXED_DT once the while loop has drained', () => {
    const { loop, alphas } = recordingLoop()

    loop.tick(FIXED_DT * 3.25)

    expect(loop.accumulator).toBeLessThan(FIXED_DT)
    expect(alphas[0]).toBe(loop.accumulator / FIXED_DT)
  })

  test('reuses one InputState across every simulate call, allocating none per frame', () => {
    const { loop, input, simulated } = recordingLoop()

    for (let frame = 0; frame < 100; frame += 1) loop.tick(1 / 60)

    expect(simulated).toHaveLength(200)
    expect(new Set(simulated).size).toBe(1)
    expect(simulated[0]).toBe(input.state)
  })
})

describe('start / stop', () => {
  /** A hand-cranked requestAnimationFrame so the driver is testable without a browser. */
  function fakeFrames() {
    let pending: ((time: number) => void) | null = null
    let cancelled = 0
    return {
      cancelled: () => cancelled,
      request: (callback: (time: number) => void) => {
        pending = callback
        return 1
      },
      cancel: () => {
        cancelled += 1
        pending = null
      },
      advance: (time: number) => {
        const callback = pending
        pending = null
        callback?.(time)
      },
      isPending: () => pending !== null,
    }
  }

  test('converts millisecond frame timestamps into second-based deltas', () => {
    const frames = fakeFrames()
    const dts: number[] = []
    const loop = createLoop({
      input: createInput({ getGamepads: () => [] }),
      simulate: (dt) => {
        dts.push(dt)
      },
      render: () => {},
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    loop.start()
    frames.advance(1000) // first frame establishes the baseline, no elapsed time yet
    frames.advance(1004) // 4 ms — a fifth of a step in seconds, but 4 whole steps in ms

    expect(dts).toHaveLength(0)
    expect(loop.accumulator).toBe(0.004)
  })

  test('drives fixed steps from wall-clock frame timestamps', () => {
    const frames = fakeFrames()
    const dts: number[] = []
    const loop = createLoop({
      input: createInput({ getGamepads: () => [] }),
      simulate: (dt) => {
        dts.push(dt)
      },
      render: () => {},
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    loop.start()
    frames.advance(1000)
    frames.advance(1020) // 20 ms banks 2.4 fixed steps

    expect(dts).toEqual([FIXED_DT, FIXED_DT])
  })

  test('stop cancels the pending frame and halts simulation', () => {
    const frames = fakeFrames()
    const dts: number[] = []
    const loop = createLoop({
      input: createInput({ getGamepads: () => [] }),
      simulate: (dt) => {
        dts.push(dt)
      },
      render: () => {},
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    loop.start()
    frames.advance(0)
    loop.stop()

    expect(loop.running).toBe(false)
    expect(frames.cancelled()).toBe(1)
    expect(frames.isPending()).toBe(false)
    expect(dts).toHaveLength(0)
  })
})

describe('keyboard input', () => {
  const attached: Input[] = []

  afterEach(() => {
    while (attached.length > 0) attached.pop()?.detach()
  })

  function attachedInput(): Input {
    const input = createInput({ getGamepads: () => [] })
    input.attach(window)
    attached.push(input)
    return input
  }

  const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }))
  const release = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code }))

  test('ArrowLeft sets left', () => {
    const input = attachedInput()

    press('ArrowLeft')

    expect(input.poll().left).toBe(true)
  })

  test('KeyA sets left', () => {
    const input = attachedInput()

    press('KeyA')

    expect(input.poll().left).toBe(true)
  })

  test('Space sets jump', () => {
    const input = attachedInput()

    press('Space')

    expect(input.poll().jump).toBe(true)
  })

  test('releasing a key clears it', () => {
    const input = attachedInput()

    press('ArrowLeft')
    press('Space')
    release('ArrowLeft')
    release('Space')

    const state = input.poll()
    expect(state.left).toBe(false)
    expect(state.jump).toBe(false)
  })

  test('releasing one of two keys bound to the same action keeps the action held', () => {
    const input = attachedInput()

    press('ArrowLeft')
    press('KeyA')
    release('KeyA')

    expect(input.poll().left).toBe(true)
  })

  test('left and right drive moveX', () => {
    const input = attachedInput()

    press('ArrowRight')
    expect(input.poll().moveX).toBe(1)

    release('ArrowRight')
    press('ArrowLeft')
    expect(input.poll().moveX).toBe(-1)
  })

  test('detach stops listening and clears held keys', () => {
    const input = attachedInput()

    press('ArrowLeft')
    input.detach()

    expect(input.poll().left).toBe(false)
  })

  test('poll returns the same object every call', () => {
    const input = attachedInput()

    expect(input.poll()).toBe(input.poll())
  })
})

describe('gamepad input', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'getGamepads')
  })

  function stubGamepads(...pads: (Gamepad | null)[]): void {
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => pads,
      configurable: true,
      writable: true,
    })
  }

  function gamepad(axes: number[], pressedButtons: number[] = []): Gamepad {
    return {
      id: 'test-pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes,
      buttons: Array.from({ length: 17 }, (_unused, i) => ({
        pressed: pressedButtons.includes(i),
        touched: false,
        value: pressedButtons.includes(i) ? 1 : 0,
      })),
    } as unknown as Gamepad
  }

  test('reads the Gamepad API through navigator.getGamepads', () => {
    stubGamepads(gamepad([-1, 0]))
    const input = createInput()

    expect(input.poll().left).toBe(true)
  })

  test('a left-pushed stick sets left and an analog moveX', () => {
    stubGamepads(gamepad([-0.8, 0]))
    const input = createInput()

    const state = input.poll()
    expect(state.left).toBe(true)
    expect(state.right).toBe(false)
    expect(state.moveX).toBeCloseTo(-0.8, 10)
  })

  test('stick drift inside the dead zone is ignored', () => {
    stubGamepads(gamepad([0.1, 0]))
    const input = createInput()

    const state = input.poll()
    expect(state.right).toBe(false)
    expect(state.moveX).toBe(0)
  })

  test('the south face button sets jump', () => {
    stubGamepads(gamepad([0, 0], [0]))
    const input = createInput()

    expect(input.poll().jump).toBe(true)
  })

  test('the d-pad sets direction digitally', () => {
    stubGamepads(gamepad([0, 0], [14]))
    const input = createInput()

    const state = input.poll()
    expect(state.left).toBe(true)
    expect(state.moveX).toBe(-1)
  })

  test('a negative Y axis is up, matching the standard mapping', () => {
    stubGamepads(gamepad([0, -1]))
    const input = createInput()

    const state = input.poll()
    expect(state.up).toBe(true)
    expect(state.down).toBe(false)
  })

  test('disconnected slots are skipped', () => {
    stubGamepads(null, gamepad([0, 0], [0]))
    const input = createInput()

    expect(input.poll().jump).toBe(true)
  })

  test('releasing the gamepad clears the state on the next poll', () => {
    stubGamepads(gamepad([-1, 0], [0]))
    const input = createInput()
    expect(input.poll().jump).toBe(true)

    stubGamepads(gamepad([0, 0]))

    const state = input.poll()
    expect(state.jump).toBe(false)
    expect(state.left).toBe(false)
  })

  test('merges into the same InputState object as the keyboard', () => {
    stubGamepads(gamepad([0, 0], [0]))
    const input = createInput()
    input.attach(window)

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }))

      const state = input.poll()
      expect(state).toBe(input.state)
      expect(state.left).toBe(true) // keyboard
      expect(state.jump).toBe(true) // gamepad
    } finally {
      input.detach()
    }
  })

  test('missing Gamepad API is not an error', () => {
    Reflect.deleteProperty(navigator, 'getGamepads')
    const input = createInput()

    expect(input.poll().jump).toBe(false)
  })
})
