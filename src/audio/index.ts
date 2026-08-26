// Synthesized sound effects for the platformer. Every effect is generated at runtime from a single
// oscillator and a gain envelope — there are no audio assets to download or bundle.
//
// Usage: playSfx('coin'). The AudioContext is created on the first call and resumed whenever the
// browser has suspended it, so callers never deal with the autoplay policy themselves.
//
// This module is a sound source only. Wiring it to gameplay events is a separate ticket.

export type {
  SfxAudioContext,
  SfxAudioNode,
  SfxAudioParam,
  SfxGainNode,
  SfxName,
  SfxOscillatorNode,
  SfxSpec,
} from './types.ts'

export { SFX_NAMES, SFX_SPECS } from './specs.ts'

export type { SfxPlayer } from './engine.ts'
export { createSfxPlayer } from './engine.ts'

export { playSfx } from './play.ts'
