/**
 * The flag's "next level IS registered" path. `src/levels/load.ts` only knows World 1-1, so
 * the swap is unreachable in the shipped build until 1-2 ships — this file registers a
 * synthetic 1-2 through the module mock instead of touching `src/levels`.
 *
 * It lives in its own file on purpose: `vi.mock` is per-module and would otherwise make the
 * YOU WIN assertions in `game-flow.test.ts` unreachable.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { START_LEVEL, START_LIVES, startGame } from '../src/main'
import type { Game } from '../src/main'
import type { Level } from '../src/levels/index.ts'

const { WORLD_1_2 } = vi.hoisted(() => ({
  WORLD_1_2: {
    id: '1-2',
    size: [8, 6],
    // 8x6 = 48 cells, top-down: five empty rows, then a solid floor.
    tiles: '40:0,8:1',
    spawn: [1, 1],
    checkpoint: [5, 1],
    entities: [
      { type: 'walker', at: [4, 1], props: { dir: 1 } },
      { type: 'walker', at: [6, 1] },
      { type: 'flag', at: [7, 1] },
    ],
    regions: [],
    theme: 'grass',
  },
}))

vi.mock('../src/levels/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/levels/index.ts')>()
  return {
    ...actual,
    loadLevel: (id: string): Level =>
      id === '1-2' ? (WORLD_1_2 as unknown as Level) : actual.loadLevel(id),
  }
})

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
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

/** Walks the player onto the 1-1 flag and runs the step that resolves it. */
function touchFlag(game: Game): void {
  game.player.body.aabb.x = 22
  game.player.body.aabb.y = 1
  game.loop.tick(1 / 120)
}

describe('the flag, with the next level registered', () => {
  test('swaps in the next level instead of ending the run', () => {
    const { container, game } = start()
    expect(START_LEVEL).toBe('1-1')

    touchFlag(game)

    expect(container.querySelector<HTMLElement>('[data-game-overlay]')?.dataset.mode).toBe(
      'playing',
    )
    expect(game.grid.width).toBe(8)
    expect(game.grid.height).toBe(6)
  })

  test('puts the player on the new spawn, at rest', () => {
    const { game } = start()

    touchFlag(game)

    expect(game.player.body.aabb.x).toBeCloseTo(1, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(1, 5)
    expect(game.player.body.velocity.x).toBe(0)
    expect(game.player.body.velocity.y).toBe(0)
  })

  test('replaces the walkers with the new level ones, in the same array', () => {
    const { game } = start()
    const walkers = game.walkers

    touchFlag(game)

    expect(game.walkers).toBe(walkers)
    expect(game.walkers).toHaveLength(2)
    expect(game.walkers[0]!.aabb.x).toBeCloseTo(4, 5)
    expect(game.walkers[0]!.dir).toBe(1)
    expect(game.walkers[1]!.aabb.x).toBeCloseTo(6, 5)
    expect(game.walkers[1]!.alive).toBe(true)

    const layer = game.scene.getObjectByName('walkers')
    expect(layer!.children).toHaveLength(2)
    expect(layer!.children).toContain(game.walkers[0]!.mesh)
  })

  test('keeps the tile batch a single instanced mesh', () => {
    const { game } = start()

    touchFlag(game)

    const instanced = game.scene.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )
    expect(instanced).toHaveLength(1)
    expect(instanced[0]!.count).toBe(8)
  })

  test('carries the lives across and starts the new level unlatched', () => {
    const { game } = start()
    // Reaching 1-1's flag means crossing its checkpoint, so the latch is set on the way in.
    game.player.body.aabb.y = -10
    game.loop.tick(1 / 120)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)

    touchFlag(game)
    game.player.body.aabb.y = -10
    game.player.body.velocity.y = -12
    game.loop.tick(1 / 120)

    expect(game.hud.getState().lives).toBe(START_LIVES - 2)
    expect(game.player.body.aabb.x).toBeCloseTo(1, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(1, 5)
  })

  test('uses the new level own checkpoint once it is passed', () => {
    const { game } = start()
    touchFlag(game)

    game.player.body.aabb.x = 6
    game.loop.tick(1 / 120)
    game.player.body.aabb.y = -10
    game.player.body.velocity.y = -12
    game.loop.tick(1 / 120)

    expect(game.player.body.aabb.x).toBeCloseTo(5, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(1, 5)
  })

  test('wins on the new level flag, whose own next level is still unregistered', () => {
    const { container, game } = start()
    touchFlag(game)

    game.player.body.aabb.x = 7
    game.player.body.aabb.y = 1
    game.loop.tick(1 / 120)

    expect(container.querySelector<HTMLElement>('[data-game-overlay]')?.dataset.mode).toBe('win')
  })
})
