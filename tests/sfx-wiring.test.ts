/**
 * T-028 — which gameplay events reach `playSfx`, and how often.
 *
 * The synthesizer itself is covered by tests/sfx.test.ts. Here `src/audio/index.ts` is
 * mocked away entirely: jsdom has no WebAudio, so the real module would degrade to a
 * silent no-op and every assertion below would pass vacuously.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { START_LEVEL, START_LIVES, startGame, type Game } from '../src/main'
import { elapseFlagToast } from './helpers/flag-toast.ts'
import { loadLevel } from '../src/levels/index.ts'

const { playSfx } = vi.hoisted(() => ({ playSfx: vi.fn() }))

vi.mock('../src/audio/index.ts', () => ({ playSfx }))

/** Every sound name handed to playSfx so far, in order. */
function played(): string[] {
  return playSfx.mock.calls.map((call) => String(call[0]))
}

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

let started: Game | null = null

function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
  // T-028: the title gates the sim, so a test run starts the way a player starts one.
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
  // T-036: that Enter now plays the run-start sting that opens the audio context, and every
  // test below is about GAMEPLAY sounds. Cleared here so the sting is not in their logs — it
  // has its own coverage in tests/wire-sfx.test.ts and tests/sfx-oscillator.test.ts.
  playSfx.mockClear()
  started = game
  return { container, game }
}

beforeEach(() => {
  playSfx.mockClear()
})

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

/** The real input listens on `window`, so a held key has to be pressed there. */
function holdJump(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
}

function releaseJump(): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
}

/** Drops the body clear of the level, still moving, as a real pit fall would. */
function fallInPit(game: Game): void {
  game.player.body.aabb.y = -10
  game.player.body.velocity.y = -12
  game.loop.tick(1 / 120)
}

/** Takes the flag of the level the run is on, which loads the next one in the chain. */
function takeFlag(game: Game, id: string): void {
  const flag = loadLevel(id).entities.find((entity) => entity.type === 'flag')
  if (!flag) throw new Error('no flag in level ' + id)
  game.player.body.aabb.x = flag.at[0]
  game.player.body.aabb.y = flag.at[1]
  game.loop.tick(1 / 120)
  // T-052: the touch only raises the level's line. The swap is on the far side of its beat.
  elapseFlagToast(game)
}

describe('jump', () => {
  test('fires on the press edge', () => {
    const { game } = start()

    holdJump()
    game.loop.tick(1 / 120)

    expect(played()).toEqual(['jump'])
  })

  test('does not re-fire while the button stays held', () => {
    const { game } = start()

    holdJump()
    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    expect(played().filter((name) => name === 'jump')).toHaveLength(1)
  })

  test('fires again on the next press after a release', () => {
    const { game } = start()

    holdJump()
    game.loop.tick(1 / 120)
    releaseJump()
    game.loop.tick(1 / 120)
    holdJump()
    game.loop.tick(1 / 120)

    expect(played().filter((name) => name === 'jump')).toHaveLength(2)
  })

  test('stays silent while the title card is still up', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, {
      width: 800,
      height: 400,
    })
    started = game

    holdJump()
    game.loop.tick(1 / 120)

    expect(played()).toEqual([])
  })
})

describe('coin', () => {
  test('fires once on the step that collects it', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!
    playSfx.mockClear()

    for (let i = 0; i < 10; i++) {
      game.player.body.aabb.x = coin.aabb.x
      game.player.body.aabb.y = coin.aabb.y
      game.loop.tick(1 / 120)
    }

    expect(played().filter((name) => name === 'coin')).toHaveLength(1)
  })
})

describe('stomp', () => {
  test('fires when a walker is stomped', () => {
    const { game } = start()
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 2
    game.player.body.velocity.y = -6

    game.loop.tick(1 / 120)

    expect(game.walkers[0]!.alive).toBe(false)
    expect(played()).toContain('stomp')
  })

  test('does not fire for a walker the player merely rises into', () => {
    const { game } = start()
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 1.5
    game.player.body.velocity.y = 6

    game.loop.tick(1 / 120)

    expect(played()).not.toContain('stomp')
  })
})

describe('flag', () => {
  test('fires on the flag that advances the run', () => {
    const { game } = start()

    takeFlag(game, START_LEVEL)

    expect(played()).toContain('flag')
  })
})

describe('death and gameover', () => {
  test('a survivable death plays death, never gameover', () => {
    const { game } = start()

    fallInPit(game)

    expect(game.hud.getState().lives).toBe(START_LIVES - 1)
    expect(played()).toEqual(['death'])
  })

  test('the last life plays gameover instead of death', () => {
    const { game } = start()
    for (let i = 0; i < START_LIVES - 1; i++) fallInPit(game)
    playSfx.mockClear()

    fallInPit(game)

    expect(game.hud.getState().lives).toBe(0)
    expect(played()).toEqual(['gameover'])
  })

  test('spends exactly one death per life before the gameover', () => {
    const { game } = start()

    for (let i = 0; i < START_LIVES; i++) fallInPit(game)

    expect(played()).toEqual(['death', 'death', 'gameover'])
  })
})
