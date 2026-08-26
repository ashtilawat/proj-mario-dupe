/**
 * T-028 — the boss stand-in, wired to whichever level actually declares one.
 *
 * The fight itself is covered by tests/boss.test.ts. This file only asserts the wiring:
 * a level with no `boss` entity spawns none, the castle spawns exactly one, its mesh is
 * drawn, and the sim steps it.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { NEXT_LEVEL, START_LEVEL, createBosses, startGame, type Game } from '../src/main'
import { loadLevel } from '../src/levels/index.ts'
import { TILE_SIZE } from '../src/physics/index.ts'
import { BOSS_HEIGHT, BOSS_WIDTH, IDLE_S } from '../src/entities/bosses/standin.ts'

/** The last level in the chain, and the only one World 1 gives a boss. */
const CASTLE = '1-castle'

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

/**
 * Walks the run down the whole NEXT_LEVEL chain by taking every flag up to, but not
 * including, the castle's — that last one would win the game instead of loading anything.
 */
function reachTheCastle(game: Game): void {
  let id: string | undefined = START_LEVEL
  while (id !== undefined && id !== CASTLE) {
    const flag = loadLevel(id).entities.find((entity) => entity.type === 'flag')
    if (!flag) throw new Error('no flag in level ' + id)
    game.player.body.aabb.x = flag.at[0]
    game.player.body.aabb.y = flag.at[1]
    game.loop.tick(1 / 120)
    id = NEXT_LEVEL[id]
  }
  if (id !== CASTLE) throw new Error('the flag chain no longer ends at ' + CASTLE)
}

describe('createBosses', () => {
  test('reads one boss per boss entity, with the facing the level asks for', () => {
    const bosses = createBosses(loadLevel(CASTLE))

    expect(bosses).toHaveLength(1)
    const boss = bosses[0]!
    expect(boss.aabb.x).toBe(8)
    expect(boss.aabb.y).toBe(1)
    expect(boss.aabb.w).toBe(BOSS_WIDTH)
    expect(boss.aabb.h).toBe(BOSS_HEIGHT)
    expect(boss.dir).toBe(1)
  })

  test('gives a level with no boss entity an empty set', () => {
    expect(createBosses(loadLevel(START_LEVEL))).toEqual([])
  })
})

describe('bosses in the scene', () => {
  test('hangs the boss meshes off a tile-scaled layer, like the walkers', () => {
    const { game } = start()
    const layer = game.scene.getObjectByName('bosses')

    expect(layer).toBeInstanceOf(THREE.Group)
    expect(game.scene.children).toContain(layer)
    expect(layer!.scale.x).toBeCloseTo(1 / TILE_SIZE, 10)
  })

  test('spawns nothing on 1-1, which declares no boss', () => {
    const { game } = start()

    expect(game.bosses).toHaveLength(0)
    expect(game.scene.getObjectByName('bosses')!.children).toHaveLength(0)
  })

  test('spawns the castle boss and draws it once the run gets there', () => {
    const { game } = start()

    reachTheCastle(game)

    expect(game.bosses).toHaveLength(1)
    expect(game.scene.getObjectByName('bosses')!.children).toContain(game.bosses[0]!.mesh)
  })

  test('renders the boss on its hitbox centre, in tile units', () => {
    const { game } = start()
    reachTheCastle(game)
    game.scene.updateMatrixWorld(true)

    // Hitbox is [8, 11] x [1, 4] in tiles, so the box centre is (9.5, 2.5).
    const position = game.bosses[0]!.mesh.getWorldPosition(new THREE.Vector3())
    expect(position.x).toBeCloseTo(9.5, 5)
    expect(position.y).toBeCloseTo(2.5, 5)
  })
})

describe('stepping the boss', () => {
  test('drives it out of its opening idle, so the pattern is actually running', () => {
    const { game } = start()
    reachTheCastle(game)
    const boss = game.bosses[0]!
    expect(boss.state).toBe('idle')

    // Just past IDLE_S, which is the whole hold before the first wind-up.
    const steps = Math.ceil(IDLE_S * 120) + 2
    for (let i = 0; i < steps; i++) game.loop.tick(1 / 120)

    expect(boss.state).not.toBe('idle')
  })

  test('leaves it frozen behind an end card, like everything else', () => {
    const { game } = start()
    reachTheCastle(game)
    const boss = game.bosses[0]!
    for (let i = 0; i < 3; i++) {
      game.player.body.aabb.y = -10
      game.player.body.velocity.y = -12
      game.loop.tick(1 / 120)
    }
    const state = boss.state
    const x = boss.aabb.x

    for (let i = 0; i < 60; i++) game.loop.tick(1 / 120)

    expect(boss.state).toBe(state)
    expect(boss.aabb.x).toBeCloseTo(x, 5)
  })
})
