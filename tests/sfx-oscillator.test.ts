/**
 * T-036 — proof that a gameplay event actually STARTS an oscillator.
 *
 * tests/sfx-wiring.test.ts and tests/wire-sfx.test.ts mock `playSfx` away, so a green run there
 * only proves the call was made. That is exactly what hid this bug: on the live URL every call
 * site fired and nothing was ever heard, because the AudioContext was first constructed inside a
 * requestAnimationFrame callback — never inside a user gesture — and a browser hands that context
 * back suspended.
 *
 * So nothing is mocked here. The real `playSfx` runs against the fake context from
 * ./helpers/fake-audio-context.ts, and the assertions are about oscillators and WHERE the context
 * was opened, not about call arguments.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WebGLRenderer } from 'three'
import { SFX_SPECS } from '../src/audio/index.ts'
import type { SfxSpec } from '../src/audio/index.ts'
import {
  installFakeAudioContext,
  signatureOf,
  uninstallFakeAudioContext,
  type FakeAudioContext,
  type FakeOscillatorNode,
} from './helpers/fake-audio-context.ts'

/** jsdom ships no WebGL; every test drives the real wiring through this stub. */
function stubRenderer() {
  return {
    domElement: document.createElement('canvas'),
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  }
}

/** The same string `signatureOf` builds, but read off the spec the sound is supposed to use. */
function expectedSignature(spec: SfxSpec): string {
  return [spec.type, spec.freqStart, spec.freqEnd, spec.durationS.toFixed(4)].join('|')
}

/** Every oscillator started so far, across every context that was opened. */
function oscillators(instances: FakeAudioContext[]): FakeOscillatorNode[] {
  return instances.flatMap((context) => context.oscillators)
}

function lastSignature(instances: FakeAudioContext[]): string {
  const started = oscillators(instances)
  const last = started[started.length - 1]
  if (!last) throw new Error('no oscillator was ever started')
  return signatureOf(last)
}

type Main = typeof import('../src/main')
type Game = ReturnType<Main['startGame']>

let started: Game | null = null

/**
 * A booted game with the title still up, and the list every AudioContext the run opens is
 * recorded into. The module registry is reset first: `src/audio/play.ts` caches its context in a
 * module-level singleton, so a stale one would leak into the next test's counts.
 */
async function boot() {
  vi.resetModules()
  // 'suspended' is what a real browser hands back for a context built outside a gesture.
  const instances = installFakeAudioContext('suspended')
  const main: Main = await import('../src/main')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = main.startGame(container, () => stubRenderer() as unknown as WebGLRenderer, {
    width: 800,
    height: 400,
  })
  started = game
  return { container, game, instances, main }
}

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

/** Boots and dismisses the title, the way a player starts a run. */
async function start() {
  const booted = await boot()
  pressEnter(booted.container)
  return booted
}

/** The real input listens on `window`, so a held key has to be pressed there. */
function pressSpace(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
}

function releaseSpace(): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
}

/** Drops the body clear of the level, still moving, as a real pit fall would. */
function fallInPit(game: Game): void {
  game.player.body.aabb.y = -10
  game.player.body.velocity.y = -12
  game.loop.tick(1 / 120)
}

afterEach(() => {
  started?.dispose()
  started = null
  releaseSpace()
  document.body.replaceChildren()
  uninstallFakeAudioContext()
})

describe('opening the audio context', () => {
  test('the Enter that dismisses the title opens a running context', async () => {
    const { container, instances } = await boot()
    expect(instances).toHaveLength(0)

    pressEnter(container)

    expect(instances).toHaveLength(1)
    expect(instances[0]!.state).toBe('running')
    expect(lastSignature(instances)).toBe(expectedSignature(SFX_SPECS.flag))
  })

  test('one context serves the whole run', async () => {
    const { game, instances } = await start()

    pressSpace()
    game.loop.tick(1 / 120)
    fallInPit(game)

    expect(instances).toHaveLength(1)
  })
})

describe('jump', () => {
  test('starts its oscillator inside the keydown, before the loop ever ticks', async () => {
    const { instances } = await start()
    const before = oscillators(instances).length

    pressSpace()

    expect(oscillators(instances)).toHaveLength(before + 1)
    expect(lastSignature(instances)).toBe(expectedSignature(SFX_SPECS.jump))
  })

  test('does not start a second oscillator on the tick that follows the press', async () => {
    const { game, instances } = await start()
    const before = oscillators(instances).length

    pressSpace()
    for (let i = 0; i < 5; i++) game.loop.tick(1 / 60)

    expect(oscillators(instances)).toHaveLength(before + 1)
  })

  test('starts nothing while the title card is still up', async () => {
    const { game, instances } = await boot()

    pressSpace()
    game.loop.tick(1 / 120)

    expect(oscillators(instances)).toHaveLength(0)
  })
})

describe('death', () => {
  test('a pit fall plays through the context the title already opened', async () => {
    const { game, instances } = await start()
    const before = oscillators(instances).length

    fallInPit(game)

    // No SECOND context: a death is never the call that opens audio, because a context opened
    // from the game loop is the suspended one that made this bug silent.
    expect(instances).toHaveLength(1)
    expect(oscillators(instances)).toHaveLength(before + 1)
    expect(lastSignature(instances)).toBe(expectedSignature(SFX_SPECS.death))
  })

  test('the last life starts the gameover oscillator instead of the death one', async () => {
    const { game, instances, main } = await start()
    for (let i = 0; i < main.START_LIVES - 1; i++) fallInPit(game)
    const before = oscillators(instances).length

    fallInPit(game)

    expect(game.hud.getState().lives).toBe(0)
    expect(oscillators(instances)).toHaveLength(before + 1)
    expect(lastSignature(instances)).toBe(expectedSignature(SFX_SPECS.gameover))
  })
})

describe('distinctness', () => {
  test('jump, death and gameover start three audibly different oscillators', async () => {
    const { game, instances, main } = await start()

    pressSpace()
    const jump = lastSignature(instances)
    fallInPit(game)
    const death = lastSignature(instances)
    for (let i = 0; i < main.START_LIVES - 1; i++) fallInPit(game)
    const gameover = lastSignature(instances)

    expect(new Set([jump, death, gameover]).size).toBe(3)
  })
})
