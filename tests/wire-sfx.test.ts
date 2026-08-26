/**
 * T-028 — the boss stand-in in the castle, and the six gameplay sounds.
 *
 * The title card and the coins have their own files (tests/title-flow.test.ts,
 * tests/coins.test.ts). This one covers what is left: that a level's `boss` entity becomes a
 * live stand-in, and that main.ts plays a sound at each of the six moments the game has.
 *
 * `playSfx` is a silent no-op under jsdom — there is no WebAudio to drive — so observing the
 * calls at all means mocking the module. Everything else here is the real wiring.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/audio/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/audio/index.ts')>()
  return { ...actual, playSfx: vi.fn() }
})

import * as THREE from 'three'
import { playSfx } from '../src/audio/index.ts'
import { NEXT_LEVEL, START_LEVEL, START_LIVES, startGame, type Game } from '../src/main'
import { elapseFlagToast } from './helpers/flag-toast.ts'
import { loadLevel } from '../src/levels/index.ts'
import { STOMP_BOUNCE, TILE_SIZE } from '../src/physics/index.ts'

const sfx = vi.mocked(playSfx)

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

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

/** Boots a game with the title still up — the run has NOT started yet. */
function boot(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
  started = game
  return { container, game }
}

/** Boots and dismisses the title, the way a player starts a run. */
function start(size = { width: 800, height: 400 }) {
  const booted = boot(size)
  pressEnter(booted.container)
  // T-036: the run-start sting that Enter plays has its own test below; clearing it here keeps
  // every other test's log to the gameplay sounds it is actually about.
  sfx.mockClear()
  return booted
}

beforeEach(() => {
  sfx.mockClear()
})

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

/** Walks the player onto the given level's flag and runs the step that resolves it. */
function takeFlagOf(game: Game, id: string): void {
  const flag = loadLevel(id).entities.find((entity) => entity.type === 'flag')
  if (!flag) throw new Error('no flag in level ' + id)
  game.player.body.aabb.x = flag.at[0]
  game.player.body.aabb.y = flag.at[1]
  game.loop.tick(1 / 120)
  // T-052: the touch only raises the level's line. The swap is on the far side of its beat.
  elapseFlagToast(game)
}

/**
 * Walks every flag from 1-1 up to, but NOT including, the castle's — so the run ends up
 * standing in the castle rather than winning on its way through.
 */
function goToCastle(game: Game): void {
  let id: string | undefined = START_LEVEL
  while (id !== undefined && NEXT_LEVEL[id] !== undefined) {
    takeFlagOf(game, id)
    id = NEXT_LEVEL[id]
  }
}

/** Drops the body clear of the level, still moving, as a real pit fall would. */
function fallInPit(game: Game): void {
  game.player.body.aabb.y = -10
  game.player.body.velocity.y = -12
  game.loop.tick(1 / 120)
}

/** The one death loop this game has: fall in the pit until the lives run out. */
function drainLives(game: Game): void {
  for (let i = 0; i < START_LIVES; i++) fallInPit(game)
}

/** Space is the jump key, and the input layer reads `code` rather than `key`. */
function holdJump(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
}

function releaseJump(): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
}

/** Every sfx name played so far, in order. */
function played(): string[] {
  return sfx.mock.calls.map((call) => String(call[0]))
}

function countOf(name: string): number {
  return played().filter((played) => played === name).length
}

/** Parks the player on the castle boss's lid, falling, so the next step is a stomp. */
function dropOnBoss(game: Game): void {
  // The boss box spans x 8..11 and y 1..4, so this is a fall straight onto its top.
  const aabb = game.player.body.aabb
  aabb.x = 9
  aabb.y = 4
  game.player.body.velocity.x = 0
  game.player.body.velocity.y = -6
}

describe('the boss stand-in', () => {
  test('spawns none on 1-1, which has no boss entity', () => {
    const { game } = start()

    expect(game.bosses).toHaveLength(0)
  })

  test('spawns the castle boss on its tile, facing the way props say', () => {
    const { game } = start()

    goToCastle(game)

    expect(game.bosses).toHaveLength(1)
    const boss = game.bosses[0]!
    expect(boss.aabb.x).toBeCloseTo(8, 5)
    expect(boss.aabb.y).toBeCloseTo(1, 5)
    expect(boss.dir).toBe(1)
    expect(boss.alive).toBe(true)
  })

  test('hangs the boss mesh off a tile-scaled layer, like the walkers', () => {
    const { game } = start()
    goToCastle(game)

    const layer = game.scene.getObjectByName('bosses')
    expect(layer).toBeInstanceOf(THREE.Group)
    expect(game.scene.children).toContain(layer)
    expect(layer!.scale.x).toBeCloseTo(1 / TILE_SIZE, 10)
    expect(layer!.children).toContain(game.bosses[0]!.mesh)
  })

  test('steps it every frame, so its pattern actually runs', () => {
    const { game } = start()
    goToCastle(game)
    const boss = game.bosses[0]!
    expect(boss.state).toBe('idle')

    // The idle hold is 0.5s and the wind-up 0.6s, so one second in it has left idle.
    for (let i = 0; i < 60; i++) game.loop.tick(1 / 60)

    expect(boss.state).not.toBe('idle')
  })

  test('bounces the player off a stomp and costs the boss a phase', () => {
    const { game } = start()
    goToCastle(game)
    const boss = game.bosses[0]!
    dropOnBoss(game)

    game.loop.tick(1 / 120)

    expect(game.player.body.velocity.y).toBe(STOMP_BOUNCE)
    expect(boss.phase).toBe(2)
  })

  test('swaps the boss set out on a level change, in the same array', () => {
    const { container, game } = start()
    goToCastle(game)
    const bosses = game.bosses
    expect(bosses).toHaveLength(1)

    drainLives(game)
    pressEnter(container)

    expect(game.bosses).toBe(bosses)
    expect(game.bosses).toHaveLength(0)
  })
})

describe('sound effects', () => {
  test('plays jump once per press, on the input edge', () => {
    const { game } = start()

    holdJump()
    game.loop.tick(1 / 60)
    expect(countOf('jump')).toBe(1)

    // Still held several frames later: the edge has already been spent.
    for (let i = 0; i < 5; i++) game.loop.tick(1 / 60)
    expect(countOf('jump')).toBe(1)

    releaseJump()
    game.loop.tick(1 / 60)
    holdJump()
    game.loop.tick(1 / 60)
    expect(countOf('jump')).toBe(2)

    releaseJump()
  })

  test('does not fire a jump that was held down through the title card', () => {
    const { container, game } = boot()

    holdJump()
    game.loop.tick(1 / 60)
    expect(played()).not.toContain('jump')

    pressEnter(container)
    game.loop.tick(1 / 60)

    expect(played()).not.toContain('jump')
    releaseJump()
  })

  test('plays stomp when a walker is stomped', () => {
    const { game } = start()
    const aabb = game.player.body.aabb
    aabb.x = 16.2
    aabb.y = 2
    game.player.body.velocity.x = 0
    game.player.body.velocity.y = -6

    game.loop.tick(1 / 120)

    expect(game.walkers[0]!.alive).toBe(false)
    expect(countOf('stomp')).toBe(1)
  })

  test('plays stomp when the castle boss is stomped', () => {
    const { game } = start()
    goToCastle(game)
    sfx.mockClear()
    dropOnBoss(game)

    game.loop.tick(1 / 120)

    expect(countOf('stomp')).toBe(1)
  })

  test('plays coin only on the frame the coin is banked', () => {
    const { game } = start()
    takeFlagOf(game, START_LEVEL)
    sfx.mockClear()
    const coin = game.coins[0]!

    for (let i = 0; i < 20; i++) {
      game.player.body.aabb.x = coin.aabb.x
      game.player.body.aabb.y = coin.aabb.y
      game.player.body.velocity.x = 0
      game.player.body.velocity.y = 0
      game.loop.tick(1 / 120)
    }

    expect(coin.collected).toBe(true)
    expect(countOf('coin')).toBe(1)
  })

  test('plays death on a life loss the run survives', () => {
    const { game } = start()

    fallInPit(game)

    expect(game.hud.getState().lives).toBe(START_LIVES - 1)
    expect(countOf('death')).toBe(1)
    expect(played()).not.toContain('gameover')
  })

  test('plays gameover instead of death on the last life', () => {
    const { game } = start()

    drainLives(game)

    expect(game.hud.getState().lives).toBe(0)
    expect(countOf('death')).toBe(START_LIVES - 1)
    expect(countOf('gameover')).toBe(1)
  })

  test('plays a start sting on the Enter that dismisses the title', () => {
    const { container } = boot()

    pressEnter(container)

    // The sound itself is the flag fanfare, reused. What matters is that it comes from the
    // keydown: `playSfx` opens the AudioContext on its first call, and a browser only hands
    // back a running one to a user gesture. tests/sfx-oscillator.test.ts checks that end.
    expect(played()).toEqual(['flag'])
  })

  test('plays flag when a flag advances the run', () => {
    const { game } = start()

    takeFlagOf(game, START_LEVEL)

    expect(countOf('flag')).toBe(1)
  })

  test('plays flag on the last flag too, the one that wins the run', () => {
    const { game } = start()
    goToCastle(game)
    sfx.mockClear()

    takeFlagOf(game, '1-castle')

    expect(countOf('flag')).toBe(1)
  })
})
