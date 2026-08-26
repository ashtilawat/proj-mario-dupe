/**
 * T-055 — the cave backdrop, as the live run actually hangs it.
 *
 * `src/render/cave-backdrop.ts` was built and tested in isolation while reaching nothing on
 * screen; its own header said so. Everything asserted here is main.ts's wiring around it. The
 * rock and the formations themselves belong to tests/cave-backdrop.test.ts and are deliberately
 * not re-asserted, and the sky colour behind them belongs to tests/underground-sky.test.ts.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { FRUSTUM_HEIGHT, startGame } from '../src/main'
import type { Game } from '../src/main'

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

/** Every object carrying `name`, however deeply parented under the scene. */
function objectsNamed(scene: THREE.Scene, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.name === name) found.push(object)
  })
  return found
}

/**
 * The one object named `name`. Throws on none and throws on duplicates — a second cave in the
 * scene is the exact failure "built once at boot, hidden rather than rebuilt" exists to prevent,
 * and a lookup that quietly took the first would never see it.
 */
function objectNamed(scene: THREE.Scene, name: string): THREE.Object3D {
  const [object, ...extra] = objectsNamed(scene, name)
  if (!object) throw new Error(`no object named "${name}" in the live scene`)
  if (extra.length > 0) throw new Error(`${extra.length + 1} objects named "${name}"`)
  return object
}

/** The T-054 cave group, found the way tests/underground-sky.test.ts finds the hills. */
function caveIn(scene: THREE.Scene): THREE.Object3D {
  return objectNamed(scene, 'cave-backdrop')
}

/**
 * The T-043 grass hills. The cave's children are named for rock — 'cave-wall', 'stalactite',
 * 'stalagmite' — so neither lookup can pick up the other's meshes.
 */
function hillsIn(scene: THREE.Scene): THREE.Object3D {
  return objectNamed(scene, 'backdrop')
}

describe('the backdrop follows the level theme', () => {
  test('boots 1-3 underground with the cave showing and the grass hills gone', () => {
    window.location.hash = '#level=1-3'

    const { game } = start()

    expect(caveIn(game.scene).visible).toBe(true)
    expect(hillsIn(game.scene).visible).toBe(false)
  })

  test('boots 1-1 grass with the hills showing and no cave', () => {
    const { game } = start()

    expect(hillsIn(game.scene).visible).toBe(true)
    expect(caveIn(game.scene).visible).toBe(false)
  })

  test('boots the castle with neither layer', () => {
    window.location.hash = '#level=1-castle'

    const { game } = start()

    // Castle is its own theme, neither grass nor underground: hills are grass art, and rock
    // closing in from the ceiling has no business inside a castle either.
    expect(caveIn(game.scene).visible).toBe(false)
    expect(hillsIn(game.scene).visible).toBe(false)
  })
})

describe('a level swap swaps the layer', () => {
  test('warping 1-3 to 1-1 puts the hills back and takes the cave away', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    // Guards the assertions below: they are vacuous if the boot never went underground.
    expect(caveIn(game.scene).visible).toBe(true)
    expect(hillsIn(game.scene).visible).toBe(false)

    warpTo('#level=1-1')

    expect(caveIn(game.scene).visible).toBe(false)
    expect(hillsIn(game.scene).visible).toBe(true)
  })

  test('warping 1-1 to 1-3 takes the hills away and brings the cave in', () => {
    const { game } = start()
    expect(caveIn(game.scene).visible).toBe(false)
    expect(hillsIn(game.scene).visible).toBe(true)

    warpTo('#level=1-3')

    expect(caveIn(game.scene).visible).toBe(true)
    expect(hillsIn(game.scene).visible).toBe(false)
  })
})

describe('the cave outlives a level swap', () => {
  test('is the same group after a warp out of underground and back', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    const before = caveIn(game.scene)

    warpTo('#level=1-1')
    warpTo('#level=1-3')

    // Not merely "a cave is still there": the level-independent art must not be torn down and
    // rebuilt per level, and `caveIn` throws on a duplicate.
    expect(caveIn(game.scene)).toBe(before)
    expect(caveIn(game.scene).visible).toBe(true)
  })
})

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((object) => {
    if (isMesh(object)) found.push(object)
  })
  return found
}

/**
 * World-space [min, max] the given meshes cover along one axis.
 *
 * The caller must have flushed the scene's world matrices first — see `rockOf`. Box3 reads
 * `matrixWorld`, and a group whose position was set but never flushed still measures at its old
 * place, which quietly turns every assertion below into a measurement of nothing.
 */
function spanOf(meshes: THREE.Mesh[], axis: 'x' | 'y'): [number, number] {
  const box = new THREE.Box3()
  for (const mesh of meshes) box.expandByObject(mesh)
  return [box.min[axis], box.max[axis]]
}

/**
 * The cave's rock masses, measured where the renderer would draw them. The stub renderer these
 * tests run against never calls `updateMatrixWorld`, so this stands in for the real
 * WebGLRenderer, which flushes the whole graph on every `render`.
 */
function rockOf(scene: THREE.Scene): THREE.Mesh[] {
  scene.updateMatrixWorld(true)
  return meshesOf(caveIn(scene)).filter((mesh) => mesh.userData['kind'] === 'cave-wall')
}

/** The band the orthographic camera actually shows, after `followPlayer` has placed it. */
function visibleY(game: Game): [number, number] {
  const half = FRUSTUM_HEIGHT / 2
  return [game.app.camera.position.y - half, game.app.camera.position.y + half]
}

function visibleX(game: Game): [number, number] {
  const { camera } = game.app
  const half = (camera.right - camera.left) / 2
  return [camera.position.x - half, camera.position.x + half]
}

/**
 * T-054 authored the cave against a camera centred on y = 0 — its rock closes in from y = ±5.
 * The live camera is not there: `followPlayer` parks it at CAMERA_Y and slides it along the
 * level. Reconciling those two frames is wiring, so it belongs to main.ts and is asserted here
 * rather than over in the module's own suite.
 */
describe('the cave is where the live camera can see it', () => {
  test('brings every rock mass into the visible band', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    game.loop.tick(1 / 120)
    const [floor, ceiling] = visibleY(game)

    const rock = rockOf(game.scene)
    // Guards the loop: an empty set would make it vacuously true.
    expect(rock.length).toBeGreaterThan(0)
    for (const mass of rock) {
      const [base, top] = spanOf([mass], 'y')
      // Real overlap with the band, both ways round. The floor row is what fails when the
      // frame is left unreconciled: unlifted, it tops out below the frustum floor and an
      // underground level reads as the empty void it does today.
      expect(top).toBeGreaterThan(floor)
      expect(base).toBeLessThan(ceiling)
    }
  })

  test('keeps rock across the whole screen once the camera has travelled', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    const startX = game.app.camera.position.x
    // Mid-level: far enough that `followPlayer` unpins the camera from its left clamp, and
    // nowhere near 1-3's flag at x = 26, which would swap grass 1-4 in and take the cave away.
    game.player.body.aabb.x = game.grid.width / 2
    game.player.body.aabb.y = 1
    game.loop.tick(1 / 120)

    const [left, right] = visibleX(game)
    const [rockLeft, rockRight] = spanOf(rockOf(game.scene), 'x')

    // Guards the two below: they are vacuous if the camera never actually moved.
    expect(game.app.camera.position.x).toBeGreaterThan(startX)
    expect(rockLeft).toBeLessThanOrEqual(left)
    expect(rockRight).toBeGreaterThanOrEqual(right)
    // Still underground: a swap would have hidden the cave and made the spans meaningless.
    expect(caveIn(game.scene).visible).toBe(true)
  })
})

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

describe('disposing the run releases the cave', () => {
  test('unparents the group', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    const cave = caveIn(game.scene)

    game.dispose()
    started = null

    expect(cave.parent).toBeNull()
    expect(objectsNamed(game.scene, 'cave-backdrop')).toHaveLength(0)
  })

  test('disposes every geometry and material it owns, exactly once each', () => {
    window.location.hash = '#level=1-3'
    const { game } = start()
    const meshes = meshesOf(caveIn(game.scene))
    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))
    // Guard the counts below: empty sets would make both loops vacuously true.
    expect(geometries.size).toBeGreaterThan(0)
    expect(materials.size).toBeGreaterThan(0)

    // Counting calls, not unique resources: the group shares one sphere geometry across every
    // wall and one cone across every formation, so a naive per-mesh loop would fire these
    // several times over and a Set on the receiving end would hide it.
    let calls = 0
    const count = (): void => {
      calls += 1
    }
    for (const geometry of geometries) geometry.addEventListener('dispose', count)
    for (const material of materials) material.addEventListener('dispose', count)

    game.dispose()
    started = null

    expect(calls).toBe(geometries.size + materials.size)
  })

  test('still releases the hills', () => {
    const { game } = start()
    const hills = hillsIn(game.scene)

    game.dispose()
    started = null

    // The cave's teardown shares its traversal with the backdrop's; this is what notices if
    // that extraction ever drops the group it was extracted from.
    expect(hills.parent).toBeNull()
  })
})
