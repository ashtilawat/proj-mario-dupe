/**
 * T-063 — the castle backdrop, as the live run actually hangs it.
 *
 * `src/render/castle-backdrop.ts` was built and tested in isolation while reaching nothing on
 * screen; its own header said so. Everything asserted here is main.ts's wiring around it. The
 * arcade itself — pillars, arches, banners, tones — belongs to tests/castle-backdrop.test.ts
 * and is deliberately not re-asserted, and the sky behind it belongs to
 * tests/underground-sky.test.ts.
 *
 * The grass and underground rows of the matrix are re-asserted here on purpose: they are what the
 * new flag has to leave alone, and tests/cave-wire.test.ts cannot see a castle group at all.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { FRUSTUM_HEIGHT, startGame } from '../src/main'
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
 * The caller must have flushed the scene's world matrices first — see `castleMeshes`. Box3 reads
 * `matrixWorld`, and a group whose position was set but never flushed still measures at its old
 * place, which quietly turns every assertion below into a measurement of nothing.
 */
function spanOf(meshes: THREE.Mesh[], axis: 'x' | 'y'): [number, number] {
  const box = new THREE.Box3()
  for (const mesh of meshes) box.expandByObject(mesh)
  return [box.min[axis], box.max[axis]]
}

/**
 * The castle's meshes of one `kind`, measured where the renderer would draw them. The stub
 * renderer these tests run against never calls `updateMatrixWorld`, so this stands in for the
 * real WebGLRenderer, which flushes the whole graph on every `render`.
 */
function castleMeshes(scene: THREE.Scene, kind: string): THREE.Mesh[] {
  scene.updateMatrixWorld(true)
  return meshesOf(castleIn(scene)).filter((mesh) => mesh.userData['kind'] === kind)
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
 * T-061 authored the hall against a camera centred on y = 0. The live camera is not there:
 * `followPlayer` parks it at CAMERA_Y and slides it along the level. Reconciling those two frames
 * is wiring, so it belongs to main.ts and is asserted here rather than in the module's own suite.
 */
describe('the castle is where the live camera can see it', () => {
  test('covers the whole visible band, floor to ceiling, with the hall wall', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    game.loop.tick(1 / 120)
    const [floor, ceiling] = visibleY(game)

    const wall = castleMeshes(game.scene, 'wall')
    // Guards the spans below, and pins the lookup: T-061 hangs exactly one wall.
    expect(wall).toHaveLength(1)
    const [base, top] = spanOf(wall, 'y')

    // Containment, not overlap, and that distinction is the whole point of this test. The wall
    // spans y = ±6 around the group, so an UNLIFTED layer still overlaps the live band [0, 10]
    // — an overlap assertion would pass against unwired code and be worth nothing. What an
    // unlifted wall cannot do is reach the ceiling: it stops at y = 6 and leaves four world
    // units of bare sky over a castle interior.
    expect(base).toBeLessThanOrEqual(floor)
    expect(top).toBeGreaterThanOrEqual(ceiling)
  })

  test('springs the arches above the middle of the frame', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    game.loop.tick(1 / 120)
    const [floor, ceiling] = visibleY(game)
    const midline = (floor + ceiling) / 2

    const arches = castleMeshes(game.scene, 'arch')
    // Guards the loop: an empty set would make it vacuously true.
    expect(arches.length).toBeGreaterThan(0)
    for (const arch of arches) {
      // Crowns, not mere overlap. Every part of this arcade already overlaps the live band
      // unlifted — the near pillars clear the frustum floor by 0.2 — so an overlap assertion
      // here passes against unwired code and pins nothing. The crowns are what move: unlifted
      // they top out at y = 2.8 against a midline of 5, and an arcade the player looks DOWN on
      // reads as a fence rather than as a hall they are standing inside.
      expect(spanOf([arch], 'y')[1]).toBeGreaterThan(midline)
    }
  })

  test('keeps every pillar standing on ground the camera never shows', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    game.loop.tick(1 / 120)
    const [floor] = visibleY(game)

    const pillars = castleMeshes(game.scene, 'pillar')
    expect(pillars.length).toBeGreaterThan(0)
    for (const pillar of pillars) {
      // T-061 put the arcade's floor below the frustum bottom so no shaft ever shows the flat cut
      // edge at its foot. This is what bounds the lift from the other side: the test above only
      // says "lift it at least this far", and a layer hoisted too high would satisfy that while
      // walking every pillar's foot into frame.
      expect(spanOf([pillar], 'y')[0]).toBeLessThan(floor)
    }
  })
})

/**
 * A viewport narrow enough that `followPlayer` actually tracks on 1-castle. The level is 18 tiles
 * wide against a half-frustum of 10 at DEFAULT_SIZE, which trips the `maxX <= minX` clamp and
 * parks the camera on the level's midpoint for the whole run — a travel assertion there would be
 * vacuous. At 1:1 the half-frustum is 5, so the camera tracks between x = 5 and x = 13.
 */
const SQUARE_SIZE: Size = { width: 400, height: 400 }

describe('the castle rides the camera', () => {
  test('keeps the hall across the whole screen once the camera has travelled', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start(SQUARE_SIZE)
    // Renders without stepping the simulation, which puts the camera on its left clamp. Reading
    // `startX` straight off the boot instead would read 0 — the position `boot` parks it at
    // before `followPlayer` has ever run — and 0 is under the clamp, so the "it moved" guard
    // below would pass on a camera that never left the clamp at all.
    game.loop.tick(0)
    const startX = game.app.camera.position.x

    // Mid-level, on the floor row, and deliberately clear of everything 1-castle places: the
    // walker at x = 5, the boss at x = 8, the coin at x = 15 and the flag at x = 17 — the last
    // of which would swap the level out and take the castle with it.
    game.player.body.aabb.x = 12
    game.player.body.aabb.y = 1
    game.loop.tick(1 / 120)

    const [left, right] = visibleX(game)
    const [wallLeft, wallRight] = spanOf(castleMeshes(game.scene, 'wall'), 'x')

    // Guards the two below: they are vacuous if the camera never actually moved.
    expect(game.app.camera.position.x).toBeGreaterThan(startX)
    expect(wallLeft).toBeLessThanOrEqual(left)
    expect(wallRight).toBeGreaterThanOrEqual(right)
    // Still in the castle: a swap would have hidden the layer and made the spans meaningless.
    expect(castleIn(game.scene).visible).toBe(true)
  })
})

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

describe('disposing the run releases the castle', () => {
  test('unparents the group', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    const castle = castleIn(game.scene)

    game.dispose()
    started = null

    expect(castle.parent).toBeNull()
    expect(objectsNamed(game.scene, 'castle-backdrop')).toHaveLength(0)
  })

  test('disposes every geometry and material it owns, exactly once each', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    const meshes = meshesOf(castleIn(game.scene))
    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))
    // Guards the count below, and states the premise: there are strictly MORE meshes than unique
    // resources, so a per-mesh loop and a de-duplicating one give different answers. Empty sets
    // would also make the loops vacuously true.
    expect(geometries.size).toBeGreaterThan(0)
    expect(materials.size).toBeGreaterThan(0)
    expect(meshes.length).toBeGreaterThan(geometries.size + materials.size)

    // Counting calls, not unique resources: the group shares one plane across the wall and both
    // banners, one box across all seven pillars, one arch shape across all five bays, and its two
    // stone materials across pillars and arches both. A naive per-mesh loop would fire these
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

  test('still releases the hills and the cave', () => {
    const { game } = start()
    const hills = hillsIn(game.scene)
    const cave = caveIn(game.scene)

    game.dispose()
    started = null

    // The castle's teardown shares `disposeGroupArt` with both of its neighbours; this is what
    // notices if the two new lines ever displace the four they sit beside.
    expect(hills.parent).toBeNull()
    expect(cave.parent).toBeNull()
  })
})
