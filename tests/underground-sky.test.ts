/**
 * T-049 — the sky the live run clears to, and whether the grass hills are hanging behind it.
 *
 * Both are per-level decisions that only `applyLevel` is in a position to make, so everything
 * here drives the real wiring: boot on a level, or swap one in, and read the scene back. The
 * hill and cloud art itself belongs to tests/backdrop.test.ts and is not re-asserted.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { startGame } from '../src/main'
import type { Game } from '../src/main'
import { SKY_COLOR, UNDERGROUND_SKY_COLOR } from '../src/render/index.ts'

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
 * Boots a run on whatever `window.location.hash` currently names, then presses Enter so the
 * title card lets go — a test run starts the way a player starts one.
 */
function start() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, {
    width: 800,
    height: 400,
  })
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
  started = game
  return { container, game }
}

/** Sets the hash and warps the way a browser does: address bar first, then the event. */
function warpTo(hash: string): void {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
  // The hash is global to the jsdom window, so a test that leaves one set would boot every
  // later file's `startGame` into the wrong level.
  window.location.hash = ''
})

/** The T-043 backdrop group, found the way tests/backdrop-wire.test.ts finds it. */
function backdropIn(scene: THREE.Scene): THREE.Object3D {
  const found: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.name === 'backdrop') found.push(object)
  })
  const [backdrop, ...extra] = found
  if (!backdrop) throw new Error('no object named "backdrop" in the live scene')
  if (extra.length > 0) throw new Error(`${extra.length + 1} backdrops in the live scene`)
  return backdrop
}

function skyOf(game: Game): number {
  const background = game.scene.background
  if (!(background instanceof THREE.Color)) {
    throw new Error(`scene.background is not a Color: ${String(background)}`)
  }
  return background.getHex()
}

describe('the sky follows the level theme', () => {
  test('boots 1-3 underground into the dark sky, with the grass hills gone', () => {
    window.location.hash = '#level=1-3'

    const { game } = start()

    expect(skyOf(game)).toBe(UNDERGROUND_SKY_COLOR)
    expect(backdropIn(game.scene).visible).toBe(false)
  })

  test('boots 1-1 grass into the blue sky, with the hills showing', () => {
    const { game } = start()

    expect(skyOf(game)).toBe(SKY_COLOR)
    expect(backdropIn(game.scene).visible).toBe(true)
  })

  test('keeps the castle sky blue but drops the grass hills', () => {
    window.location.hash = '#level=1-castle'

    const { game } = start()

    // Castle is its own theme, not underground: the sky is untouched. The hills are grass
    // art, so they have no business standing behind a castle.
    expect(skyOf(game)).toBe(SKY_COLOR)
    expect(backdropIn(game.scene).visible).toBe(false)
  })
})

describe('a level swap puts the sky back', () => {
  test('warping 1-3 to 1-1 restores the blue sky and the hills', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    // Guards the assertions below: they are vacuous if the boot never went underground.
    expect(skyOf(game)).toBe(UNDERGROUND_SKY_COLOR)
    expect(backdropIn(game.scene).visible).toBe(false)

    warpTo('#level=1-1')

    expect(skyOf(game)).toBe(SKY_COLOR)
    expect(backdropIn(game.scene).visible).toBe(true)
  })
})
