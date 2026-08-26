import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { createTileGridFromLevel, startGame, type Game } from '../src/main'

/** jsdom ships no WebGL; every test drives the real wiring through this stub. */
function stubRenderer() {
  const calls = { render: 0, setSize: [] as Array<[number, number]> }
  const renderer = {
    domElement: document.createElement('canvas'),
    setSize(width: number, height: number) {
      calls.setSize.push([width, height])
    },
    setPixelRatio() {},
    render() {
      calls.render += 1
    },
    dispose() {},
  }
  return { renderer, calls }
}

let started: Game | null = null

function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const { renderer, calls } = stubRenderer()
  const game = startGame(container, () => renderer as unknown as THREE.WebGLRenderer, size)
  // T-028: the title card gates the sim until Enter, so a test run starts the way a player
  // starts one. The card itself is covered by tests/title-flow.test.ts.
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
  started = game
  return { container, game, calls }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

describe('createTileGridFromLevel', () => {
  test('has the level 1-1 dimensions and a 1 world unit tile', () => {
    const grid = createTileGridFromLevel('1-1')

    expect(grid.width).toBe(24)
    expect(grid.height).toBe(12)
    expect(grid.tileSize).toBe(1)
  })

  test('flips the Tiled row order so ty=0 is the bottom floor', () => {
    const grid = createTileGridFromLevel('1-1')

    expect(grid.getTile(2, 0)).toBe('solid')
    expect(grid.getTile(0, 0)).toBe('solid')
    expect(grid.getTile(2, 5)).toBe('empty')
  })

  test('reports out-of-bounds cells as empty', () => {
    const grid = createTileGridFromLevel('1-1')

    expect(grid.getTile(-1, 0)).toBe('empty')
    expect(grid.getTile(24, 0)).toBe('empty')
    expect(grid.getTile(0, -1)).toBe('empty')
    expect(grid.getTile(0, 12)).toBe('empty')
  })
})

describe('startGame', () => {
  test('mounts the renderer canvas and the HUD into the container', () => {
    const { container, game } = start()

    expect(container.contains(game.app.renderer.domElement)).toBe(true)
    expect(container.querySelector('canvas')).not.toBeNull()
    expect(container.querySelector('[data-hud-root]')).not.toBeNull()
  })

  test('populates the scene boot handed it — not a blank world', () => {
    const { game } = start()

    expect(game.scene).toBe(game.app.scene)
    expect(game.scene.children.length).toBeGreaterThan(0)
  })

  test('draws the solid tiles as a single instanced mesh', () => {
    const { game } = start()

    const instanced = game.scene.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )
    expect(instanced).toHaveLength(1)
    expect(instanced[0]!.count).toBeGreaterThan(0)
  })

  test('adds the debug overlay group so hitboxes are visible', () => {
    const { game } = start()

    expect(game.scene.children).toContain(game.overlay.group)
    expect(game.scene.getObjectByName('debug-overlay')).toBe(game.overlay.group)
    expect(game.overlay.hitboxesVisible).toBe(true)
  })

  test('spawns the player hitbox at the level spawn point', () => {
    const { game } = start()

    expect(game.grid.width).toBe(24)
    expect(game.scene.children).toContain(game.player.mesh)
    expect(game.player.body.aabb.x).toBeCloseTo(2, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(1, 5)
  })

  test('ticking the loop renders and does not throw', () => {
    const { game, calls } = start()

    expect(() => game.loop.tick(1 / 60)).not.toThrow()
    expect(calls.render).toBeGreaterThan(0)
  })

  test('leaves an idle player resting on the floor', () => {
    const { game } = start()

    for (let i = 0; i < 60; i++) game.loop.tick(1 / 60)

    expect(game.player.body.aabb.y).toBeCloseTo(1, 5)
    expect(game.player.grounded).toBe(true)
  })

  test('feeds the player hitbox and velocity to the debug overlay each render', () => {
    const { game } = start()

    game.loop.tick(1 / 60)

    const hitboxes = game.overlay.group.getObjectByName('debug-hitboxes')
    expect(hitboxes?.children.length).toBe(1)
    expect(game.overlay.group.getObjectByName('debug-velocities')?.children.length).toBe(1)
  })

  test('dispose stops the loop and unmounts the canvas and HUD', () => {
    const { container, game } = start()
    started = null

    game.dispose()

    expect(game.loop.running).toBe(false)
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('[data-hud-root]')).toBeNull()
  })
})
