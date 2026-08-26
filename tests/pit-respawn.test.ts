import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { START_LEVEL, startGame, type Game } from '../src/main'
import { loadLevel } from '../src/levels/index.ts'

/** jsdom ships no WebGL; every test drives the real wiring through this stub. */
function stubRenderer() {
  const renderer = {
    domElement: document.createElement('canvas'),
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  }
  return renderer
}

let started: Game | null = null

function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(
    container,
    () => stubRenderer() as unknown as THREE.WebGLRenderer,
    size,
  )
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

describe('falling into a pit', () => {
  test('costs a life and respawns the player at the level spawn', () => {
    const { game } = start()
    const [spawnX, spawnY] = loadLevel(START_LEVEL).spawn
    expect(game.hud.getState().lives).toBe(3)

    // Drop the body clear of the level, still moving, as a real pit fall would.
    game.player.body.aabb.y = -10
    game.player.body.velocity.x = 3
    game.player.body.velocity.y = -12

    game.loop.tick(1 / 60)

    expect(game.hud.getState().lives).toBe(2)
    expect(game.player.body.aabb.x).toBeCloseTo(spawnX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(spawnY, 5)
    expect(game.player.body.velocity.x).toBe(0)
    expect(game.player.body.velocity.y).toBe(0)
  })

  // tick(1/60) runs two 120 Hz steps, and the second one lands the player — which zeroes
  // vy on its own. Driving a single step is the only way to see the respawn's own zeroing.
  test('respawns at rest, before gravity has had a step to act', () => {
    const { game } = start()
    const [, spawnY] = loadLevel(START_LEVEL).spawn

    game.player.body.aabb.y = -10
    game.player.body.velocity.y = -12

    game.loop.tick(1 / 120)

    expect(game.player.body.aabb.y).toBeCloseTo(spawnY, 5)
    expect(game.player.body.velocity.y).toBe(0)
  })

  // x = 20 is past the checkpoint at 12, so this fall respawns at the checkpoint rather
  // than back at the spawn — the camera has to follow the player wherever they land.
  test('keeps following the respawned player with the camera', () => {
    const { game } = start()
    const [checkpointX] = loadLevel(START_LEVEL).checkpoint

    game.player.body.aabb.x = 20
    game.player.body.aabb.y = -10
    game.loop.tick(1 / 60)

    expect(game.player.body.aabb.x).toBeCloseTo(checkpointX, 5)
    const halfWidth = (game.app.camera.right - game.app.camera.left) / 2
    const maxX = game.grid.width - halfWidth
    const centerX = checkpointX + game.player.body.aabb.w / 2
    expect(game.app.camera.position.x).toBeCloseTo(
      Math.min(Math.max(centerX, halfWidth), maxX),
      5,
    )
  })

  test('does not cost a life while the player idles on the floor', () => {
    const { game } = start()

    for (let i = 0; i < 60; i++) game.loop.tick(1 / 60)

    expect(game.hud.getState().lives).toBe(3)
    expect(game.player.grounded).toBe(true)
  })
})
