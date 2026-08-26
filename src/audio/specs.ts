// The sound table. No mp3/wav: every effect is synthesized from one oscillator, so the bundle
// stays asset-free for the static deploy.
//
// Each entry is unique on the (type, freqStart, freqEnd, durationS) tuple, which is what makes the
// six effects tell each other apart by ear. Keep it that way when tuning: tests assert it.

import type { SfxName, SfxSpec } from './types.ts'

export const SFX_NAMES: readonly SfxName[] = [
  'jump',
  'stomp',
  'coin',
  'death',
  'flag',
  'gameover',
]

export const SFX_SPECS: Record<SfxName, SfxSpec> = {
  /** Short rising chirp — reads as "up". */
  jump: { type: 'square', freqStart: 440, freqEnd: 880, durationS: 0.12, peakGain: 0.18 },
  /** Short falling thud, an octave down, to answer the jump chirp. */
  stomp: { type: 'square', freqStart: 220, freqEnd: 110, durationS: 0.1, peakGain: 0.25 },
  /** Bright B5 -> E6 ping; triangle keeps it sweet rather than harsh. */
  coin: { type: 'triangle', freqStart: 988, freqEnd: 1319, durationS: 0.18, peakGain: 0.2 },
  /** Long descending buzz — sawtooth for the sour edge. */
  death: { type: 'sawtooth', freqStart: 400, freqEnd: 80, durationS: 0.6, peakGain: 0.22 },
  /** C5 -> C6 rising fanfare for clearing the level. */
  flag: { type: 'triangle', freqStart: 523, freqEnd: 1047, durationS: 0.45, peakGain: 0.2 },
  /** The longest and lowest fall: run out of lives and everything winds down. */
  gameover: { type: 'sawtooth', freqStart: 300, freqEnd: 60, durationS: 1.2, peakGain: 0.22 },
}
