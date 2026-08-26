// The one entry point the game calls: playSfx('jump').
//
// An AudioContext cannot be built at import time — browsers refuse to start one before a user
// gesture, and jsdom has no WebAudio at all — so the context is created lazily on the first sound
// and reused after that. Same lazy-resolve-or-degrade shape as resolveClipboard in debug/tuning.ts.

import { createSfxPlayer, type SfxPlayer } from './engine.ts'
import { SFX_SPECS } from './specs.ts'
import type { SfxAudioContext, SfxName, SfxSpec } from './types.ts'

type AudioContextConstructor = new () => SfxAudioContext

interface AudioOutput {
  readonly context: SfxAudioContext
  readonly player: SfxPlayer
}

let output: AudioOutput | undefined

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  const candidate: unknown =
    Reflect.get(globalThis, 'AudioContext') ?? Reflect.get(globalThis, 'webkitAudioContext')
  return typeof candidate === 'function' ? (candidate as AudioContextConstructor) : undefined
}

function ensureOutput(): AudioOutput | undefined {
  if (output !== undefined) return output

  const AudioContextCtor = resolveAudioContextConstructor()
  // No WebAudio in this environment (jsdom, or a very old browser). Stay silent rather than throw:
  // sound is feedback, never a reason to take down the game loop.
  if (AudioContextCtor === undefined) return undefined

  const context = new AudioContextCtor()
  output = { context, player: createSfxPlayer(context) }
  return output
}

function lookupSpec(name: string): SfxSpec | undefined {
  return Object.hasOwn(SFX_SPECS, name) ? SFX_SPECS[name as SfxName] : undefined
}

/**
 * Plays one sound effect. Never throws and never returns a promise, so a caller on the fixed-step
 * game loop can fire and forget.
 *
 * An unknown name is a compile error; a name forced past the type system is a no-op.
 */
export function playSfx(name: SfxName): void {
  // Resolved before any context is opened, so a bad name has no side effects at all.
  const spec = lookupSpec(name)
  if (spec === undefined) return

  const active = ensureOutput()
  if (active === undefined) return

  // Checked on every call, not just the first: browsers suspend an idle context, and a
  // first-call-only guard would leave the game permanently silent afterwards.
  if (active.context.state === 'suspended') {
    void active.context.resume().catch(() => {})
  }

  active.player.play(spec)
}
