import * as THREE from 'three'
import { createInput, createLoop } from './engine/index.ts'
import type { Loop } from './engine/index.ts'
import { createDashInput, createPlayer } from './entities/player/index.ts'
import type { Player } from './entities/player/index.ts'
import { createWalker } from './entities/enemies/walker.ts'
import type { Walker } from './entities/enemies/walker.ts'
import { decodeTiles, loadLevel } from './levels/index.ts'
import type { Level } from './levels/index.ts'
import { TILE_SIZE } from './physics/index.ts'
import type { TileGrid, TileKind } from './physics/index.ts'
import { GAMEPLAY_Z, createLights } from './render/index.ts'
import { createHud } from './ui/index.ts'
import type { Hud } from './ui/index.ts'
import { createDebugOverlay } from './debug/index.ts'
import type { DebugBody, DebugOverlay } from './debug/index.ts'

/** Vertical size of the orthographic frustum, in world units. */
export const FRUSTUM_HEIGHT = 10

/** Distance the camera is pulled back along +Z so the origin is in front of it. */
export const CAMERA_DISTANCE = 20

export const BACKGROUND_COLOR = 0x101014

export type RendererFactory = (canvas: HTMLCanvasElement) => THREE.WebGLRenderer

export interface Size {
  width: number
  height: number
}

export interface App {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  renderer: THREE.WebGLRenderer
  resize(width: number, height: number): void
  render(): void
  dispose(): void
}

/**
 * Orthographic camera parked on +Z, looking down -Z at the origin.
 * The frustum height is fixed; width follows the viewport aspect ratio.
 */
export function createCamera(aspect: number): THREE.OrthographicCamera {
  const halfHeight = FRUSTUM_HEIGHT / 2
  const halfWidth = halfHeight * aspect
  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.1,
    1000,
  )
  camera.position.set(0, 0, CAMERA_DISTANCE)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  return camera
}

/** An empty scene. M0 renders nothing but the clear color. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)
  return scene
}

export const createWebGLRenderer: RendererFactory = (canvas) =>
  new THREE.WebGLRenderer({ canvas, antialias: true })

export function boot(
  container: HTMLElement,
  createRenderer: RendererFactory = createWebGLRenderer,
  size: Size = { width: window.innerWidth, height: window.innerHeight },
): App {
  const renderer = createRenderer(document.createElement('canvas'))
  const scene = createScene()
  const camera = createCamera(size.width / size.height)

  container.appendChild(renderer.domElement)

  const app: App = {
    scene,
    camera,
    renderer,
    resize(width, height) {
      const halfHeight = FRUSTUM_HEIGHT / 2
      const halfWidth = halfHeight * (width / height)
      camera.left = -halfWidth
      camera.right = halfWidth
      camera.top = halfHeight
      camera.bottom = -halfHeight
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    },
    render() {
      renderer.render(scene, camera)
    },
    dispose() {
      renderer.dispose()
      renderer.domElement.remove()
    },
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  app.resize(size.width, size.height)

  return app
}

/** The level World 1-1 boots into. */
export const START_LEVEL = '1-1'

/** Camera height, in tiles. The 10-tile frustum then covers the whole 12-tile level. */
export const CAMERA_Y = 5

/** Flat gray so the boxes read as blockout geometry, not art. */
export const TILE_COLOR = 0x8b8b93

/**
 * A {@link TileGrid} over a level's decoded GIDs. Tiled rows run top-down while physics Y
 * runs up, so row 0 of the RLE is the TOP row and has to be flipped: ty = 0 is the floor.
 * One tile is one world unit here — TILE_SIZE is a render-only conversion this game skips.
 */
export function createTileGridFromLevel(id: string): TileGrid {
  const level = loadLevel(id)
  const [width, height] = level.size
  const decoded = decodeTiles(level.tiles, width, height)

  return {
    width,
    height,
    tileSize: 1,
    getTile(tx: number, ty: number): TileKind {
      if (tx < 0 || tx >= width || ty < 0 || ty >= height) return 'empty'
      const gid = decoded[(height - 1 - ty) * width + tx] ?? 0
      return gid > 0 ? 'solid' : 'empty'
    },
  }
}

/**
 * Every solid tile as one instanced 1x1 quad batch, so the whole level is a single draw
 * call. Instance i is centred on its tile: tile (tx, ty) spans [tx, tx+1) x [ty, ty+1).
 */
export function createTileMesh(grid: TileGrid): THREE.InstancedMesh {
  let count = 0
  for (let ty = 0; ty < grid.height; ty += 1) {
    for (let tx = 0; tx < grid.width; tx += 1) {
      if (grid.getTile(tx, ty) === 'solid') count += 1
    }
  }

  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshLambertMaterial({ color: TILE_COLOR })
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = 'tiles'

  const dummy = new THREE.Object3D()
  let i = 0
  for (let ty = 0; ty < grid.height; ty += 1) {
    for (let tx = 0; tx < grid.width; tx += 1) {
      if (grid.getTile(tx, ty) !== 'solid') continue
      dummy.position.set(tx + 0.5, ty + 0.5, GAMEPLAY_Z)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      i += 1
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** The level entity type the walker factory answers to. */
export const WALKER_ENTITY = 'walker'

/**
 * Every walker spawn point in a level, as live enemies. `props` is the level format's
 * free-form record, so `dir` is matched against -1 explicitly; anything else faces +X.
 */
export function createWalkers(level: Level): Walker[] {
  return level.entities
    .filter((entity) => entity.type === WALKER_ENTITY)
    .map((entity, index) =>
      createWalker({
        x: entity.at[0],
        y: entity.at[1],
        dir: entity.props?.dir === -1 ? -1 : 1,
        id: index,
      }),
    )
}

/**
 * One parent for every walker mesh. Walker art is authored in world units (TILE_SIZE per
 * tile) while this game draws one world unit per tile, so the whole enemy layer is scaled
 * down here instead of reaching into walker.ts. A plain Group, so the tile batch stays the
 * scene's only InstancedMesh.
 */
export function createWalkerLayer(walkers: Walker[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'walkers'
  group.scale.setScalar(1 / TILE_SIZE)
  for (const walker of walkers) group.add(walker.mesh)
  return group
}

export interface Game {
  app: App
  scene: THREE.Scene
  player: Player
  walkers: Walker[]
  hud: Hud
  loop: Loop
  grid: TileGrid
  overlay: DebugOverlay
  dispose(): void
}

/**
 * Boots the renderer and fills the scene it handed back with the playable World 1-1:
 * lights, the tile batch, the player capsule and the debug overlay. `boot` and
 * `createScene` stay deliberately empty — the game lives here.
 */
export function startGame(
  container: HTMLElement,
  createRenderer: RendererFactory = createWebGLRenderer,
  size: Size = { width: window.innerWidth, height: window.innerHeight },
): Game {
  const app = boot(container, createRenderer, size)
  const { scene, camera } = app

  const grid = createTileGridFromLevel(START_LEVEL)
  const level = loadLevel(START_LEVEL)
  const [spawnX, spawnY] = level.spawn

  const { directional, hemisphere } = createLights()
  const tiles = createTileMesh(grid)
  const player = createPlayer({ x: spawnX, y: spawnY, grid })
  const overlay = createDebugOverlay()
  const walkers = createWalkers(level)
  const walkerLayer = createWalkerLayer(walkers)
  scene.add(directional, hemisphere, tiles, player.mesh, walkerLayer, overlay.group)

  const hud = createHud()
  hud.mount(container)

  const input = createInput()
  const dash = createDashInput()
  input.attach(window)
  dash.attach(window)

  // Reused every frame so a 120 Hz loop allocates nothing for the overlay.
  const debugVelocity = { vx: 0, vy: 0 }
  const debugBodies: DebugBody[] = [{ aabb: player.body.aabb, velocity: debugVelocity }]

  const loop = createLoop({
    input,
    simulate(dt, state) {
      // tryStomp compares the stomper's feet against where they were before this step,
      // and nothing on the player records that — so capture it here, before stepping.
      const prevBottom = player.body.aabb.y
      player.step(dt, dash.poll(state))

      for (const walker of walkers) walker.step(dt, grid)

      // A stomp is the walker's call: it checks the fall direction and the overlap, then
      // hands back the bounce to spend. Defeated walkers just stop being drawn.
      for (const walker of walkers) {
        const bounce = walker.tryStomp(player.body.aabb, player.body.velocity.y, prevBottom)
        if (bounce === 0) continue
        player.body.velocity.y = bounce
        walker.mesh.visible = false
      }

      // Fell out of the level: nothing below y=0 can ever catch the body, so the fall
      // costs a life and puts the player back on the level spawn at rest.
      const aabb = player.body.aabb
      if (aabb.y + aabb.h < 0) {
        hud.setLives(hud.getState().lives - 1)
        aabb.x = spawnX
        aabb.y = spawnY
        player.body.velocity.x = 0
        player.body.velocity.y = 0
      }
    },
    render() {
      followPlayer(camera, player, grid)
      debugVelocity.vx = player.body.velocity.x
      debugVelocity.vy = player.body.velocity.y
      overlay.setBodies(debugBodies)
      app.render()
    },
  })
  loop.start()

  return {
    app,
    scene,
    player,
    walkers,
    hud,
    loop,
    grid,
    overlay,
    dispose() {
      loop.stop()
      input.detach()
      dash.detach()
      overlay.dispose()
      hud.unmount()
      tiles.geometry.dispose()
      ;(tiles.material as THREE.Material).dispose()
      tiles.removeFromParent()
      for (const walker of walkers) {
        walker.mesh.geometry.dispose()
        walker.mesh.material.dispose()
      }
      walkerLayer.removeFromParent()
      app.dispose()
    },
  }
}

/** Tracks the player horizontally, clamped so the camera never leaves the level. */
function followPlayer(camera: THREE.OrthographicCamera, player: Player, grid: TileGrid): void {
  const halfWidth = (camera.right - camera.left) / 2
  const centerX = player.body.aabb.x + player.body.aabb.w / 2
  const minX = halfWidth
  const maxX = grid.width - halfWidth
  camera.position.x = maxX <= minX ? grid.width / 2 : Math.min(Math.max(centerX, minX), maxX)
  camera.position.y = CAMERA_Y
}

/** Browser entry point. Starts World 1-1 and keeps it sized to the window. */
function main(): void {
  const container = document.getElementById('app')
  if (!container) throw new Error('#app container not found')

  const game = startGame(container)
  window.addEventListener('resize', () =>
    game.app.resize(window.innerWidth, window.innerHeight),
  )
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  main()
}
