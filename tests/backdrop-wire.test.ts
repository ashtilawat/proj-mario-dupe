/**
 * T-043 — the sky backdrop, as the live run actually hangs it.
 *
 * `src/render/backdrop.ts` was built and tested in isolation while reaching nothing on
 * screen; its own header said so. Everything asserted here is main.ts's wiring around it —
 * the hills and clouds themselves are covered by tests/backdrop.test.ts and are deliberately
 * not re-asserted.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { startGame } from '../src/main'
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

function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
  // T-028: the title card gates the sim until Enter, so a test run starts the way a player
  // starts one.
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

/** Every backdrop group hanging anywhere under the scene, however deeply parented. */
function backdropsIn(scene: THREE.Scene): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.name === 'backdrop') found.push(object)
  })
  return found
}

function backdropIn(scene: THREE.Scene): THREE.Object3D {
  const [backdrop, ...extra] = backdropsIn(scene)
  if (!backdrop) throw new Error('no object named "backdrop" in the live scene')
  if (extra.length > 0) throw new Error(`${extra.length + 1} backdrops in the live scene`)
  return backdrop
}

/**
 * Walks the player onto the 1-1 flag and runs the step that resolves it, swapping 1-2 in.
 *
 * The width assertion is the point: without it, a 1-1 whose flag has moved off (22, 1) would
 * turn every caller below into "the same object is still the same object" after a tick that
 * did nothing, and they would pass forever.
 */
function touchFlag(game: Game): void {
  const widthBefore = game.grid.width
  game.player.body.aabb.x = 22
  game.player.body.aabb.y = 1
  game.loop.tick(1 / 120)
  expect(game.grid.width).not.toBe(widthBefore)
}

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

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

describe('the live scene carries the sky backdrop', () => {
  test('hangs exactly one backdrop group', () => {
    const { game } = start()

    const backdrop = backdropIn(game.scene)

    expect(backdrop).toBeInstanceOf(THREE.Group)
    expect(meshesOf(backdrop).length).toBeGreaterThan(0)
  })

  test('parks it behind the tile batch', () => {
    const { game } = start()

    const backdropZ = backdropIn(game.scene).getWorldPosition(new THREE.Vector3()).z
    const tiles = game.scene.children.find(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )

    expect(tiles).toBeDefined()
    expect(backdropZ).toBeLessThan(tiles!.getWorldPosition(new THREE.Vector3()).z)
  })
})

describe('the backdrop outlives a level swap', () => {
  test('is the same group after the flag swaps the world out', () => {
    const { game } = start()
    const before = backdropIn(game.scene)

    touchFlag(game)

    // Not merely "a backdrop is still there": the level-independent art must not be torn
    // down and rebuilt per level, and `backdropIn` throws on a duplicate.
    expect(backdropIn(game.scene)).toBe(before)
  })
})

describe('disposing the run releases the backdrop', () => {
  test('unparents the group', () => {
    const { game } = start()
    const backdrop = backdropIn(game.scene)

    game.dispose()
    started = null

    expect(backdrop.parent).toBeNull()
    expect(backdropsIn(game.scene)).toHaveLength(0)
  })

  test('disposes every geometry and material it owns', () => {
    const { game } = start()
    const meshes = meshesOf(backdropIn(game.scene))
    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))
    // Guard the counts below: an empty set would make both loops vacuously true.
    expect(geometries.size).toBeGreaterThan(0)
    expect(materials.size).toBeGreaterThan(0)

    // Counting calls, not unique resources: the group shares one geometry across every hill
    // and one material across every cloud, so a naive per-mesh loop would fire these several
    // times over and a Set would hide it.
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
})
