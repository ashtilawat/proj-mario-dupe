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
import { loadLevel } from '../src/levels/index.ts'
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
}

/** Parks the player on a coin's hitbox so the next step collects it. */
function standOn(game: Game, coin: Coin): void {
  game.player.body.aabb.x = coin.aabb.x
  game.player.body.aabb.y = coin.aabb.y
  game.player.body.velocity.x = 0
  game.player.body.velocity.y = 0
}

describe('createCoins', () => {
  test('reads one coin per coin entity, on the walker convention', () => {
    const coins = createCoins(loadLevel('1-3'))

    expect(coins.map((coin) => [coin.aabb.x, coin.aabb.y])).toEqual([
      [7, 5],
      [18, 5],
    ])
    expect(coins[0]!.aabb.w).toBe(1)
    expect(coins[0]!.aabb.h).toBe(1)
  })

  test('ignores level entities that are not coins', () => {
    const level = loadLevel('1-3')

    // 1-3 carries two walkers and a flag alongside its two coins.
    expect(level.entities.length).toBeGreaterThan(2)
    expect(createCoins(level)).toHaveLength(2)
  })

  test('gives World 1-1, which has no coins at all, an empty set', () => {
    expect(createCoins(loadLevel(START_LEVEL))).toEqual([])
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

  test('starts empty on 1-1 and fills up when a level with coins loads', () => {
    const { game } = start()
    expect(game.coins).toHaveLength(0)

    takeFlag(game, START_LEVEL)

    expect(NEXT_LEVEL[START_LEVEL]).toBe('1-2')
    expect(game.coins).toHaveLength(1)
    expect(game.scene.getObjectByName('coins')!.children).toContain(game.coins[0]!.mesh)
  })

  test('renders the coin on its hitbox centre, in tile units', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    game.scene.updateMatrixWorld(true)

    // 1-2's coin sits at [12, 5], so the disc centre is (12.5, 5.5).
    const position = game.coins[0]!.mesh.getWorldPosition(new THREE.Vector3())
    expect(position.x).toBeCloseTo(12.5, 5)
    expect(position.y).toBeCloseTo(5.5, 5)
  })

  test('swaps the whole coin set out on the next level', () => {
    const { game } = start()
    takeFlag(game, START_LEVEL)
    const stale = game.coins[0]!

    takeFlag(game, '1-2')

    expect(game.coins).toHaveLength(2)
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
