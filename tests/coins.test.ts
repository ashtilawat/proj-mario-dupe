/**
 * T-028 — coins, from level data to the HUD.
 *
 * `Coin` itself is covered by src/entities/pickups/coin.test.ts. This file is about the
 * wiring: which entities become coins, where their meshes live, and that a run can only
 * ever score a given coin once.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { NEXT_LEVEL, START_LEVEL, createCoins, startGame, type Game } from '../src/main'
import { elapseFlagToast } from './helpers/flag-toast.ts'
import { loadLevel } from '../src/levels/index.ts'
import { FIXED_DT } from '../src/engine/index.ts'
import { COIN_SPIN_SPEED } from '../src/entities/pickups/coin.ts'
import { TILE_SIZE } from '../src/physics/index.ts'
import type { Coin } from '../src/entities/pickups/index.ts'

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
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

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

/** Parks the player on a coin's hitbox so the next step collects it. */
function standOn(game: Game, coin: Coin): void {
  game.player.body.aabb.x = coin.aabb.x
  game.player.body.aabb.y = coin.aabb.y
  game.player.body.velocity.x = 0
  game.player.body.velocity.y = 0
}

function coinEntities(id: string) {
  return loadLevel(id).entities.filter((entity) => entity.type === 'coin')
}

describe('createCoins', () => {
  test('reads one coin per coin entity, on the walker convention', () => {
    const level = loadLevel('1-3')
    const named = coinEntities('1-3')
    const coins = createCoins(level)

    expect(coins.map((coin) => [coin.aabb.x, coin.aabb.y])).toEqual(
      named.map((entity) => [entity.at[0], entity.at[1]]),
    )
    expect(coins[0]!.aabb.w).toBe(1)
    expect(coins[0]!.aabb.h).toBe(1)
  })

  test('ignores level entities that are not coins', () => {
    const level = loadLevel('1-3')
    const named = coinEntities('1-3')

    // 1-3 carries walkers and a flag alongside its coins.
    expect(level.entities.length).toBeGreaterThan(named.length)
    expect(createCoins(level)).toHaveLength(named.length)
  })

  test('reads World 1-1 coins from its entities', () => {
    const level = loadLevel(START_LEVEL)
    const named = coinEntities(START_LEVEL)
    expect(named.length).toBeGreaterThan(0)
    expect(createCoins(level)).toHaveLength(named.length)
  })

  test('gives a level with no coin entities an empty set', () => {
    const level = loadLevel(START_LEVEL)
    expect(createCoins({ ...level, entities: level.entities.filter((e) => e.type !== 'coin') })).toEqual(
      [],
    )
  })
})

describe('coins in the scene', () => {
  test('hangs the coin meshes off a tile-scaled layer, like the walkers', () => {
    const { game } = start()
    const layer = game.scene.getObjectByName('coins')

    expect(layer).toBeInstanceOf(THREE.Group)
    expect(game.scene.children).toContain(layer)
    expect(layer!.scale.x).toBeCloseTo(1 / TILE_SIZE, 10)
  })

  test('starts 1-1 with its JSON coins and swaps in 1-2 coins on the flag', () => {
    const { game } = start()
    expect(game.coins).toHaveLength(coinEntities(START_LEVEL).length)

    takeFlag(game, START_LEVEL)

    expect(NEXT_LEVEL[START_LEVEL]).toBe('1-2')
    expect(game.coins).toHaveLength(coinEntities('1-2').length)
    expect(game.scene.getObjectByName('coins')!.children).toContain(game.coins[0]!.mesh)
  })

  test('renders the coin on its hitbox centre, in tile units', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    game.scene.updateMatrixWorld(true)

    const coin = game.coins[0]!
    const position = coin.mesh.getWorldPosition(new THREE.Vector3())
    expect(position.x).toBeCloseTo(coin.aabb.x + coin.aabb.w / 2, 5)
    expect(position.y).toBeCloseTo(coin.aabb.y + coin.aabb.h / 2, 5)
  })

  test('swaps the whole coin set out on the next level', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const stale = game.coins[0]!

    takeFlag(game, '1-2')

    expect(game.coins).toHaveLength(coinEntities('1-3').length)
    expect(game.coins).not.toContain(stale)
    expect(game.scene.getObjectByName('coins')!.children).not.toContain(stale.mesh)
  })
})

describe('collecting a coin', () => {
  test('scores it on the HUD and takes the disc off screen', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!
    expect(game.hud.getState().coins).toBe(0)

    standOn(game, coin)
    game.loop.tick(1 / 120)

    expect(coin.collected).toBe(true)
    expect(coin.mesh.visible).toBe(false)
    expect(game.hud.getState().coins).toBe(1)
  })

  test('scores once however many frames the overlap lasts', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!

    for (let i = 0; i < 20; i++) {
      standOn(game, coin)
      game.loop.tick(1 / 120)
    }

    expect(game.hud.getState().coins).toBe(1)
  })

  test('leaves a coin the player never touches alone', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)

    for (let i = 0; i < 60; i++) game.loop.tick(1 / 60)

    expect(game.coins[0]!.collected).toBe(false)
    expect(game.hud.getState().coins).toBe(0)
  })

  test('keeps the run total across a level change', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    standOn(game, game.coins[0]!)
    game.loop.tick(1 / 120)

    takeFlag(game, '1-2')
    standOn(game, game.coins[0]!)
    game.loop.tick(1 / 120)

    expect(game.hud.getState().coins).toBe(2)
  })

  test('is zeroed again by an Enter restart', () => {
    const { container, game } = start()
    takeFlag(game, START_LEVEL)
    standOn(game, game.coins[0]!)
    game.loop.tick(1 / 120)
    expect(game.hud.getState().coins).toBe(1)

    // Die out, then restart from the card.
    for (let i = 0; i < 3; i++) {
      game.player.body.aabb.y = -10
      game.player.body.velocity.y = -12
      game.loop.tick(1 / 120)
    }
    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    )

    expect(game.hud.getState().coins).toBe(0)
  })
})

describe('spinning coins', () => {
  test('advances an untouched coin every simulate tick', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!
    const before = coin.mesh.rotation.y

    game.loop.tick(FIXED_DT)

    expect(coin.collected).toBe(false)
    expect(coin.mesh.rotation.y - before).toBeCloseTo(COIN_SPIN_SPEED * FIXED_DT, 10)
  })

  test('spins a coin the player is nowhere near, not just the one under them', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    takeFlag(game, '1-2')
    const [touched, untouched] = [game.coins[0]!, game.coins[1]!]

    standOn(game, touched)
    game.loop.tick(FIXED_DT)

    // The overlap collected one disc; the far one has to have turned all the same.
    expect(touched.collected).toBe(true)
    expect(untouched.collected).toBe(false)
    expect(untouched.mesh.rotation.y).toBeCloseTo(COIN_SPIN_SPEED * FIXED_DT, 10)
  })

  test('leaves a collected coin where it stopped', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!
    standOn(game, coin)
    game.loop.tick(FIXED_DT)
    // Non-vacuous: it turned on the tick it was taken, and stops from there.
    const stopped = coin.mesh.rotation.y
    expect(stopped).toBeGreaterThan(0)

    for (let i = 0; i < 30; i++) game.loop.tick(FIXED_DT)

    expect(coin.collected).toBe(true)
    expect(coin.mesh.rotation.y).toBe(stopped)
  })

  test('holds the spin still while an end card has the run frozen', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!

    // Out of lives: the card goes up and the world stops where it stood.
    for (let i = 0; i < 3; i++) {
      game.player.body.aabb.y = -10
      game.player.body.velocity.y = -12
      game.loop.tick(FIXED_DT)
    }
    // Non-vacuous: the fatal ticks spun it, so this is a stop, not a coin that never moved.
    const frozen = coin.mesh.rotation.y
    expect(frozen).toBeGreaterThan(0)

    for (let i = 0; i < 30; i++) game.loop.tick(FIXED_DT)

    expect(coin.mesh.rotation.y).toBe(frozen)
  })

  test('keeps the hitbox and the pickup working through a spin', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const coin = game.coins[0]!
    const box = { ...coin.aabb }

    // Well past a quarter turn, where a spun disc is edge-on to the camera.
    for (let i = 0; i < 60; i++) game.loop.tick(FIXED_DT)
    expect(coin.mesh.rotation.y).toBeGreaterThan(Math.PI / 2)
    expect({ ...coin.aabb }).toEqual(box)

    standOn(game, coin)
    game.loop.tick(FIXED_DT)

    expect(coin.collected).toBe(true)
    expect(game.hud.getState().coins).toBe(1)
  })
})
