/**
 * T-035 — the story copy and the tile art, as the live run actually shows them.
 *
 * Both modules were finished and tested in isolation while reaching nothing on screen:
 * `src/story` said so in its own header, and `src/render/tile-art.ts` named the exact
 * one-liner that would close the gap. Everything asserted here is main.ts's wiring around
 * them — the modules' own behaviour is covered by tests/story.test.ts and
 * tests/tile-art.test.ts, and is deliberately not re-asserted.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { startGame, type Game } from '../src/main'
import { title as storyTitle } from '../src/story/index.ts'
import { DEFAULT_HEADING, PROMPT_TEXT } from '../src/ui/title.ts'
import { CASTLE_THEME, GRASS_THEME, tileArtForTheme } from '../src/render'

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

/**
 * Deliberately does NOT dismiss the title: half this file is about what the card says, and
 * the tile batch is built by the boot's `applyLevel` before Enter is ever pressed.
 */
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

describe('the title card carries the story title', () => {
  test('the live heading is the name from src/story, not the placeholder', () => {
    // Guard the comparison below: without these it would still pass if the story title were
    // empty, or if it happened to be the very placeholder this ticket is replacing.
    expect(storyTitle).not.toBe('')
    expect(storyTitle).not.toBe(DEFAULT_HEADING)

    const { game } = start()

    const heading = game.title.element.querySelector('[data-title-heading]')
    expect(heading?.textContent).toBe(storyTitle)
  })

  test('keeps the Press Enter prompt', () => {
    const { game } = start()

    const prompt = game.title.element.querySelector('[data-title-prompt]')
    expect(prompt?.textContent).toBe(PROMPT_TEXT)
    expect(PROMPT_TEXT).toBe('Press Enter')
  })
})

describe('the gameplay tile batch carries the tile art', () => {
  test('the booted level 1-1 batch is mapped with the grass art', () => {
    // Guard the identity assertion below: it only says something about which theme was
    // asked for if the two themes are actually distinct texture objects.
    expect(tileArtForTheme(GRASS_THEME).texture).not.toBe(tileArtForTheme(CASTLE_THEME).texture)

    const { game } = start()

    const tiles = game.scene.getObjectByName('tiles') as THREE.InstancedMesh
    expect(tiles).toBeDefined()
    const material = tiles.material as THREE.MeshLambertMaterial
    expect(material.map).toBe(tileArtForTheme(GRASS_THEME).texture)
  })

  test('leaves the grass/dirt palette to multiply against the grayscale map', () => {
    const { game } = start()

    // The map adds surface detail; it must not have flattened the per-instance palette or
    // tinted the white base color, or grass and dirt would stop being different colors.
    const tiles = game.scene.getObjectByName('tiles') as THREE.InstancedMesh
    const material = tiles.material as THREE.MeshLambertMaterial
    expect(material.color.getHex()).toBe(0xffffff)
    expect(tiles.instanceColor).not.toBeNull()
  })
})
