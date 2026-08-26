/**
 * A fake WebAudio context, shared by every test that drives the real `playSfx`.
 *
 * jsdom ships no WebAudio at all, so the production path degrades to a silent no-op unless a
 * context constructor is installed on globalThis. The fakes implement the seam interfaces from
 * `src/audio/types.ts` directly (no `any` casts), so a change to those signatures breaks the
 * tests at typecheck time instead of silently passing.
 *
 * Not a `.test.ts` file on purpose: vitest collects `tests/**\/*.test.ts`, so this is a helper
 * rather than an empty suite.
 */
import type {
  SfxAudioContext,
  SfxAudioNode,
  SfxAudioParam,
  SfxGainNode,
  SfxOscillatorNode,
} from '../../src/audio/index.ts'

export type ParamCall = [method: string, value: number, time: number]

export class FakeAudioParam implements SfxAudioParam {
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

export class FakeOscillatorNode implements SfxOscillatorNode {
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

export class FakeGainNode implements SfxGainNode {
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

export class FakeAudioContext implements SfxAudioContext {
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
export function installFakeAudioContext(initialState: AudioContextState): FakeAudioContext[] {
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

/** Removes both context constructors, so the next test starts from a bare environment. */
export function uninstallFakeAudioContext(): void {
  Reflect.deleteProperty(globalThis, 'AudioContext')
  Reflect.deleteProperty(globalThis, 'webkitAudioContext')
}

/** What makes one effect audibly different from another: waveform, pitch sweep, and length. */
export function signatureOf(oscillator: FakeOscillatorNode): string {
  const start = oscillator.frequency.calls[0]
  const end = oscillator.frequency.calls[1]
  const duration = (oscillator.stopTime ?? 0) - (oscillator.startTime ?? 0)
  return [oscillator.type, start?.[1], end?.[1], duration.toFixed(4)].join('|')
}
