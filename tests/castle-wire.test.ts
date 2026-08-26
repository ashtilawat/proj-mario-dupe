/**
 * T-063 — the castle backdrop, as the live run actually hangs it.
 *
 * `src/render/castle-backdrop.ts` was built and tested in isolation while reaching nothing on
 * screen; its own header said so. Everything asserted here is main.ts's wiring around it. The
 * arcade itself — pillars, arches, banners, tones — belongs to tests/castle-backdrop.test.ts and
 * is deliberately not re-asserted, and the sky behind it belongs to tests/underground-sky.test.ts.
 *
 * The grass and underground rows of the matrix are re-asserted here on purpose: they are what the
 * new flag has to leave alone, and tests/cave-wire.test.ts cannot see a castle group at all.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { startGame } from '../src/main'
import type { Game, Size } from '../src/main'

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
 * The viewport every test boots at unless it says otherwise. 2:1 like tests/cave-wire.test.ts,
 * which gives a half-frustum of 10 world units.
 */
const DEFAULT_SIZE: Size = { width: 800, height: 400 }

/**
 * Boots a run on whatever `window.location.hash` currently names, then presses Enter so the
 * title card lets go — a test run starts the way a player starts one.
 */
function start(size: Size = DEFAULT_SIZE) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
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

/** Every object carrying `name`, however deeply parented under the scene. */
function objectsNamed(scene: THREE.Scene, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.name === name) found.push(object)
  })
  return found
}

/**
 * The one object named `name`. Throws on none and throws on duplicates — a second castle in the
 * scene is the exact failure "built once at boot, hidden rather than rebuilt" exists to prevent,
 * and a lookup that quietly took the first would never see it.
 */
function objectNamed(scene: THREE.Scene, name: string): THREE.Object3D {
  const [object, ...extra] = objectsNamed(scene, name)
  if (!object) throw new Error(`no object named "${name}" in the live scene`)
  if (extra.length > 0) throw new Error(`${extra.length + 1} objects named "${name}"`)
  return object
}

/** The T-061 castle group, found the way tests/cave-wire.test.ts finds the cave. */
function castleIn(scene: THREE.Scene): THREE.Object3D {
  return objectNamed(scene, 'castle-backdrop')
}

/** The T-054 cave. */
function caveIn(scene: THREE.Scene): THREE.Object3D {
  return objectNamed(scene, 'cave-backdrop')
}

/**
 * The T-043 grass hills. Each group's children are named for its own material — 'hill' and
 * 'cloud', 'cave-wall' and 'stalactite', 'wall' and 'pillar' and 'arch' — so no lookup here can
 * pick up another layer's meshes.
 */
function hillsIn(scene: THREE.Scene): THREE.Object3D {
  return objectNamed(scene, 'backdrop')
}

/**
 * The whole visibility matrix in one read, in matrix order: hills, cave, castle. A triple rather
 * than three separate assertions because the contract IS the triple — a flag that shows the
 * castle while leaving the hills up is as wrong as one that never shows it.
 */
function layersIn(scene: THREE.Scene): [boolean, boolean, boolean] {
  return [hillsIn(scene).visible, caveIn(scene).visible, castleIn(scene).visible]
}

describe('booting a level shows exactly one backdrop', () => {
  test('1-castle gets the castle, and neither the hills nor the cave', () => {
    window.location.hash = '#level=1-castle'

    const { game } = start()

    expect(layersIn(game.scene)).toEqual([false, false, true])
  })

  test('1-1 grass keeps its hills, with no castle behind them', () => {
    const { game } = start()

    expect(layersIn(game.scene)).toEqual([true, false, false])
  })

  test('1-3 underground keeps its cave, with no castle behind it', () => {
    window.location.hash = '#level=1-3'

    const { game } = start()

    expect(layersIn(game.scene)).toEqual([false, true, false])
  })
})

describe('warping between themes swaps the layer', () => {
  test('1-1 to 1-castle raises the castle and drops the hills', () => {
    const { game } = start()
    // Guards the assertion below: it is vacuous if the boot never showed the hills.
    expect(layersIn(game.scene)).toEqual([true, false, false])

    warpTo('#level=1-castle')

    expect(layersIn(game.scene)).toEqual([false, false, true])
  })

  test('1-castle to 1-1 drops the castle and puts the hills back', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    expect(layersIn(game.scene)).toEqual([false, false, true])

    warpTo('#level=1-1')

    expect(layersIn(game.scene)).toEqual([true, false, false])
  })

  test('1-3 to 1-castle swaps rock for stone with the hills still down', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    expect(layersIn(game.scene)).toEqual([false, true, false])

    warpTo('#level=1-castle')

    expect(layersIn(game.scene)).toEqual([false, false, true])
  })

  test('1-castle to 1-3 swaps stone for rock with the hills still down', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    expect(layersIn(game.scene)).toEqual([false, false, true])

    warpTo('#level=1-3')

    expect(layersIn(game.scene)).toEqual([false, true, false])
  })
})

describe('the castle outlives a level swap', () => {
  test('is the same group after a warp out of the castle and back', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    const before = castleIn(game.scene)

    warpTo('#level=1-1')
    warpTo('#level=1-castle')

    // Not merely "a castle is still there": the level-independent art must not be torn down and
    // rebuilt per level, and `castleIn` throws on a duplicate.
    expect(castleIn(game.scene)).toBe(before)
    expect(castleIn(game.scene).visible).toBe(true)
  })
})
