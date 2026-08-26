// Minimal structural view of the WebAudio nodes this module touches.
//
// jsdom has no WebAudio at all, so tests supply their own implementations of these interfaces.
// Declaring the seam here — rather than depending on the DOM `AudioContext` types — means a fake
// is typechecked against the same contract the production path uses, with no `any` casts in tests.

/** Every sound effect the game can play. Closed union: an unknown name is a compile error. */
export type SfxName = 'jump' | 'stomp' | 'coin' | 'death' | 'flag' | 'gameover'

/**
 * A single synthesized blip. Pitch sweeps from `freqStart` to `freqEnd` across `durationS`. Both
 * endpoints must be greater than zero, because the sweep is an exponential ramp.
 */
export interface SfxSpec {
  readonly type: OscillatorType
  readonly freqStart: number
  readonly freqEnd: number
  readonly durationS: number
  readonly peakGain: number
}

export interface SfxAudioParam {
  setValueAtTime(value: number, startTime: number): void
  linearRampToValueAtTime(value: number, endTime: number): void
  exponentialRampToValueAtTime(value: number, endTime: number): void
}

export interface SfxAudioNode {
  connect(destination: SfxAudioNode): void
  disconnect(): void
}

export interface SfxGainNode extends SfxAudioNode {
  readonly gain: SfxAudioParam
}

export interface SfxOscillatorNode extends SfxAudioNode {
  type: OscillatorType
  readonly frequency: SfxAudioParam
  onended: (() => void) | null
  start(when: number): void
  stop(when: number): void
}

export interface SfxAudioContext {
  readonly currentTime: number
  readonly destination: SfxAudioNode
  readonly state: AudioContextState
  createOscillator(): SfxOscillatorNode
  createGain(): SfxGainNode
  resume(): Promise<void>
}
