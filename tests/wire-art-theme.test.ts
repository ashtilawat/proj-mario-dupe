/**
 * T-035 — proof that the tile art follows `Level.theme` rather than a hardcoded 'grass'.
 *
 * Every shipped World 1 level is grass except the castle, and reaching the castle from a
 * test means playing six flags. So the theme is supplied instead: `loadLevel` is mocked to
 * hand back a castle-themed 1-1, and the assertion is that the boot's tile batch came out
 * brick. A `applyTileArt(tiles, 'grass')` would pass tests/wire-art.test.ts and fail here.
 *
 * It lives in its own file on purpose: `vi.mock` is per-module and would otherwise force
 * the real-data assertions in wire-art.test.ts through this synthetic level. Same reasoning
 * — and the same shape — as tests/game-flow-advance.test.ts.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { startGame, type Game } from '../src/main'
import type { Level } from '../src/levels/index.ts'
import { CASTLE_THEME, GRASS_THEME, tileArtForTheme } from '../src/render'

const { CASTLE_1_1 } = vi.hoisted(() => ({
  CASTLE_1_1: {
    id: '1-1',
    size: [8, 6],
    // 8x6 = 48 cells, top-down: five empty rows, then a solid floor.
    tiles: '40:0,8:1',
    spawn: [1, 1],
    checkpoint: [5, 1],
    entities: [],
    regions: [],
    // The whole point of the fixture. Everything above it is the minimum a level needs to
    // boot; this is the one field under test.
    theme: 'castle',
  },
}))

vi.mock('../src/levels/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/levels/index.ts')>()
  return {
    ...actual,
    loadLevel: (id: string): Level => {
      if (id === '1-1') return CASTLE_1_1 as unknown as Level
      throw new Error('Unknown level: ' + id)
    },
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

describe('tile art follows the loaded level theme', () => {
  test('a castle-themed level boots with the brick art, not the ground art', () => {
    // Guard the identity assertions: they only mean something if the themes differ.
    expect(tileArtForTheme(CASTLE_THEME).texture).not.toBe(tileArtForTheme(GRASS_THEME).texture)

    const { game } = start()

    const tiles = game.scene.getObjectByName('tiles') as THREE.InstancedMesh
    const material = tiles.material as THREE.MeshLambertMaterial
    expect(material.map).toBe(tileArtForTheme(CASTLE_THEME).texture)
    expect(material.map).not.toBe(tileArtForTheme(GRASS_THEME).texture)
  })
})
