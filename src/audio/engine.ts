// Turns an SfxSpec into a scheduled oscillator -> gain -> destination graph.
//
// Takes its context as an argument and reads no globals, so it is exercised directly in tests with
// a fake context. Owning the audio-graph details here keeps play.ts free to worry only about
// singleton and autoplay-policy concerns.

import type { SfxAudioContext, SfxSpec } from './types.ts'

/** Envelope attack, seconds. Long enough to avoid a click, short enough to stay percussive. */
const ATTACK_S = 0.01

/** `exponentialRampToValueAtTime` cannot target 0, so "silent" is a small positive amplitude. */
const SILENCE = 0.0001

export interface SfxPlayer {
  play(spec: SfxSpec): void
}

export function createSfxPlayer(context: SfxAudioContext): SfxPlayer {
  return {
    play(spec: SfxSpec): void {
      const startedAt = context.currentTime
      const endsAt = startedAt + spec.durationS

      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.connect(gain)
      gain.connect(context.destination)

      // Pitch sweeps exponentially because pitch is perceived logarithmically: a linear ramp
      // sounds like it slows down as it climbs.
      oscillator.type = spec.type
      oscillator.frequency.setValueAtTime(spec.freqStart, startedAt)
      oscillator.frequency.exponentialRampToValueAtTime(spec.freqEnd, endsAt)

      // Open from silence and decay back to it. Starting an oscillator at full amplitude pops.
      // Very short effects get a proportionally shorter attack so it never eats the whole sound.
      const attackS = Math.min(ATTACK_S, spec.durationS / 2)
      gain.gain.setValueAtTime(SILENCE, startedAt)
      gain.gain.linearRampToValueAtTime(spec.peakGain, startedAt + attackS)
      gain.gain.exponentialRampToValueAtTime(SILENCE, endsAt)

      // Release the nodes once they have finished, so a long play session does not accumulate a
      // graph of dead oscillators.
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
      }

      oscillator.start(startedAt)
      oscillator.stop(endsAt)
    },
  }
}
