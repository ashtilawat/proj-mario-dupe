import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  SfxAudioContext,
  SfxAudioNode,
  SfxAudioParam,
  SfxGainNode,
  SfxName,
  SfxOscillatorNode,
} from '../src/audio/index.ts'

// jsdom ships no WebAudio, so every test drives the module through a fake context installed on
// globalThis. The fakes implement the seam interfaces directly (no `any` casts), so a change to
// those signatures breaks these tests at typecheck time instead of silently passing.

type ParamCall = [method: string, value: number, time: number]

class FakeAudioParam implements SfxAudioParam {
  readonly calls: ParamCall[] = []

  setValueAtTime(value: number, startTime: number): void {
    this.calls.push(['setValueAtTime', value, startTime])
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push(['linearRamp', value, endTime])
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push(['exponentialRamp', value, endTime])
  }
}

class FakeOscillatorNode implements SfxOscillatorNode {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeAudioParam()
  onended: (() => void) | null = null
  startTime: number | null = null
  stopTime: number | null = null
  connectedTo: SfxAudioNode | null = null
  disconnectCount = 0

  connect(destination: SfxAudioNode): void {
    this.connectedTo = destination
  }

  disconnect(): void {
    this.disconnectCount += 1
  }

  start(when: number): void {
    this.startTime = when
  }

  stop(when: number): void {
    this.stopTime = when
  }
}

class FakeGainNode implements SfxGainNode {
  readonly gain = new FakeAudioParam()
  connectedTo: SfxAudioNode | null = null
  disconnectCount = 0

  connect(destination: SfxAudioNode): void {
    this.connectedTo = destination
  }

  disconnect(): void {
    this.disconnectCount += 1
  }
}

class FakeAudioContext implements SfxAudioContext {
  currentTime = 0
  state: AudioContextState = 'suspended'
  readonly destination: SfxAudioNode = { connect: () => {}, disconnect: () => {} }
  readonly oscillators: FakeOscillatorNode[] = []
  readonly gains: FakeGainNode[] = []
  resumeCalls = 0

  createOscillator(): SfxOscillatorNode {
    const oscillator = new FakeOscillatorNode()
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain(): SfxGainNode {
    const gain = new FakeGainNode()
    this.gains.push(gain)
    return gain
  }

  resume(): Promise<void> {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }
}

/** Installs a fake AudioContext constructor; returns the list it records its instances into. */
function installFakeAudioContext(initialState: AudioContextState): FakeAudioContext[] {
  const instances: FakeAudioContext[] = []
  class RecordingAudioContext extends FakeAudioContext {
    constructor() {
      super()
      this.state = initialState
      instances.push(this)
    }
  }
  Reflect.set(globalThis, 'AudioContext', RecordingAudioContext)
  return instances
}

/** Fresh module registry per test, so the lazily-created context singleton never leaks across. */
async function loadAudio() {
  return await import('../src/audio/index.ts')
}

/** What makes one effect audibly different from another: waveform, pitch sweep, and length. */
function signatureOf(oscillator: FakeOscillatorNode): string {
  const start = oscillator.frequency.calls[0]
  const end = oscillator.frequency.calls[1]
  const duration = (oscillator.stopTime ?? 0) - (oscillator.startTime ?? 0)
  return [oscillator.type, start?.[1], end?.[1], duration.toFixed(4)].join('|')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'AudioContext')
  Reflect.deleteProperty(globalThis, 'webkitAudioContext')
})

describe('playSfx context lifecycle', () => {
  test('resumes a suspended context on the first call', async () => {
    const instances = installFakeAudioContext('suspended')
    const { playSfx } = await loadAudio()

    playSfx('jump')

    expect(instances).toHaveLength(1)
    const context = instances[0]!
    expect(context.resumeCalls).toBe(1)
    expect(context.oscillators).toHaveLength(1)
  })

  test('does not resume a context that is already running', async () => {
    const instances = installFakeAudioContext('running')
    const { playSfx } = await loadAudio()

    playSfx('coin')

    expect(instances[0]!.resumeCalls).toBe(0)
  })

  test('reuses one context across calls instead of opening one per sound', async () => {
    const instances = installFakeAudioContext('suspended')
    const { playSfx } = await loadAudio()

    playSfx('jump')
    playSfx('coin')
    playSfx('stomp')

    expect(instances).toHaveLength(1)
    expect(instances[0]!.oscillators).toHaveLength(3)
  })

  test('degrades to a no-op when the environment has no WebAudio', async () => {
    expect(Reflect.get(globalThis, 'AudioContext')).toBeUndefined()
    const { playSfx } = await loadAudio()

    expect(() => playSfx('coin')).not.toThrow()
  })
})

describe('sound distinctness', () => {
  test('every effect schedules a different waveform, pitch sweep, or duration', async () => {
    const instances = installFakeAudioContext('running')
    const { playSfx, SFX_NAMES } = await loadAudio()

    for (const name of SFX_NAMES) playSfx(name)

    const context = instances[0]!
    expect(SFX_NAMES).toHaveLength(6)
    expect(context.oscillators).toHaveLength(SFX_NAMES.length)

    const signatures = context.oscillators.map(signatureOf)
    expect(new Set(signatures).size).toBe(SFX_NAMES.length)
  })

  test('jump is a short rising square blip with a click-free envelope', async () => {
    const instances = installFakeAudioContext('running')
    const { playSfx } = await loadAudio()

    playSfx('jump')

    const context = instances[0]!
    const oscillator = context.oscillators[0]!
    const gain = context.gains[0]!

    expect(oscillator.type).toBe('square')
    expect(oscillator.frequency.calls[0]).toEqual(['setValueAtTime', 440, 0])
    expect(oscillator.frequency.calls[1]).toEqual(['exponentialRamp', 880, 0.12])
    expect(oscillator.startTime).toBe(0)
    expect(oscillator.stopTime).toBeCloseTo(0.12, 6)

    // The envelope opens from near-silence and decays back to it, so neither edge clicks.
    const [open, attack, decay] = gain.gain.calls
    expect(open![0]).toBe('setValueAtTime')
    expect(open![1]).toBeLessThan(0.001)
    expect(attack![0]).toBe('linearRamp')
    expect(attack![1]).toBeGreaterThan(0)
    expect(attack![2]).toBeGreaterThan(0)
    expect(attack![2]).toBeLessThan(0.12)
    expect(decay![0]).toBe('exponentialRamp')
    expect(decay![1]).toBeLessThan(0.001)
    expect(decay![2]).toBeCloseTo(0.12, 6)

    expect(oscillator.connectedTo).toBe(gain)
    expect(gain.connectedTo).toBe(context.destination)
  })

  test('schedules against the context clock rather than from zero', async () => {
    const instances = installFakeAudioContext('running')
    const { playSfx } = await loadAudio()
    playSfx('jump')
    const context = instances[0]!
    context.currentTime = 12.5

    playSfx('jump')

    const second = context.oscillators[1]!
    expect(second.startTime).toBe(12.5)
    expect(second.stopTime).toBeCloseTo(12.62, 6)
  })
})

describe('unknown names', () => {
  test('a forced bad name is a silent no-op that never opens an audio context', async () => {
    const instances = installFakeAudioContext('suspended')
    const { playSfx } = await loadAudio()

    expect(() => playSfx('nope' as SfxName)).not.toThrow()

    expect(instances).toHaveLength(0)
  })

  test('a bad name is a compile error', async () => {
    const { playSfx } = await loadAudio()
    // @ts-expect-error - SfxName is a closed union. tsconfig `include` covers tests/, so this line
    // fails `npm run typecheck` if playSfx ever starts accepting arbitrary strings.
    expect(() => playSfx('nope')).not.toThrow()
  })
})

describe('createSfxPlayer', () => {
  test('releases its nodes once the sound has finished', async () => {
    const { createSfxPlayer, SFX_SPECS } = await loadAudio()
    const context = new FakeAudioContext()

    createSfxPlayer(context).play(SFX_SPECS.coin)

    const oscillator = context.oscillators[0]!
    const gain = context.gains[0]!
    expect(oscillator.disconnectCount).toBe(0)

    oscillator.onended?.()

    expect(oscillator.disconnectCount).toBe(1)
    expect(gain.disconnectCount).toBe(1)
  })
})
