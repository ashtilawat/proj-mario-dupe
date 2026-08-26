import * as THREE from 'three'
import type { TileGrid } from '../physics/index.ts'
import { DIRT_COLOR, GRASS_TOP_COLOR, applyTileArt } from './tile-art.ts'

export * from './tile-art.ts'
export { createBackdrop } from './backdrop.ts'

/** Vertical size of the orthographic frustum, in world units. */
export const FRUSTUM_HEIGHT = 10

/** Distance the camera is pulled back along +Z so the origin is in front of it. */
export const CAMERA_DISTANCE = 20

/** Gameplay tile layer sits on the XY plane. */
export const GAMEPLAY_Z = 0

/** Background parallax stub; must stay in [-40, -10]. */
export const BG_Z = -20

/** Foreground stub in front of gameplay. */
export const FG_Z = 10

const TILE_SIZE = 1
const GAMEPLAY_TILE_COUNT = 8
const BG_TILE_COUNT = 4
const FG_TILE_COUNT = 3

const GAMEPLAY_COLOR = 0x4a7c4e
const BG_COLOR = 0x2a3a52
const FG_COLOR = 0x8aa36b
const PLAYER_COLOR = 0xe8c547

// World 1-1 grass palette. It lives here rather than in main.ts so the live scene and the
// render module draw from one set of hex values. The two tile hexes moved next to the tile art
// they tint, in tile-art.ts, and are re-exported above — this stays their one import site.

/** Clear color for the grass theme. Blue-dominant, so the void reads as sky. */
// The underground counterpart is UNDERGROUND_SKY_COLOR in tile-art.ts; not wired to a level yet.
export const SKY_COLOR = 0x5c94fc

/**
 * Which palette entry a solid tile is drawn in. Grass is the default and dirt is the
 * exception, so a top-row tile falls through to grass without a special case — the grids
 * this game builds report out-of-bounds cells as `empty`. Only the cell above matters;
 * this is a per-tile lookup, not a scan.
 */
export function tileColorAt(grid: Pick<TileGrid, 'getTile'>, tx: number, ty: number): number {
  return grid.getTile(tx, ty + 1) === 'solid' ? DIRT_COLOR : GRASS_TOP_COLOR
}

export interface TileLayerOptions {
  count: number
  z: number
  color?: number
  /** Which theme's tile art to map onto the layer. Defaults to grass. */
  theme?: string
}

export interface DrawCallSource {
  info: {
    render: {
      calls: number
    }
  }
}

/**
 * Orthographic camera parked on +Z, looking down -Z at the origin.
 * Frustum height is fixed; width follows the given aspect ratio.
 */
export function createCamera(aspect: number): THREE.OrthographicCamera {
  const halfH = FRUSTUM_HEIGHT / 2
  const halfW = halfH * aspect
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000)
  camera.position.set(0, 0, CAMERA_DISTANCE)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  return camera
}

/** Constructs a WebGLRenderer bound to the given canvas. */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({ canvas, antialias: true })
}

export function createLights(): {
  directional: THREE.DirectionalLight
  hemisphere: THREE.HemisphereLight
} {
  const directional = new THREE.DirectionalLight(0xffffff, 0.9)
  directional.position.set(4, 8, 6)
  const hemisphere = new THREE.HemisphereLight(0xb8d0ff, 0x3a2a18, 0.55)
  return { directional, hemisphere }
}

/**
 * Batched tile quads for one depth layer. Instance matrices are filled so the
 * mesh is a real InstancedMesh, not an empty batch. The mesh itself is parked
 * at the layer Z; tests inspect object.position.z.
 */
export function createTileLayer(opts: TileLayerOptions): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE)
  const material = new THREE.MeshLambertMaterial({
    color: opts.color ?? GAMEPLAY_COLOR,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, opts.count)

  const dummy = new THREE.Object3D()
  const cols = Math.max(1, Math.ceil(Math.sqrt(opts.count)))
  for (let i = 0; i < opts.count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    dummy.position.set(col - (cols - 1) / 2, -row, 0)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.position.z = opts.z
  // Surface art on top of the flat layer color, so the blockout layers read as ground rather
  // than as solid swatches. The map multiplies with opts.color; it does not replace it.
  applyTileArt(mesh, opts.theme)
  return mesh
}

/** Visual-only player stand-in. No physics, no velocity. */
export function createPlayerCapsule(): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(0.35, 0.8, 4, 8)
  const material = new THREE.MeshLambertMaterial({ color: PLAYER_COLOR })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0, 0.75, GAMEPLAY_Z)
  return mesh
}

/**
 * Scene graph for M0: three instanced tile layers, one capsule, and two lights.
 * Direct children only — no per-tile Mesh objects.
 */
export function createRenderScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.add(createTileLayer({ count: GAMEPLAY_TILE_COUNT, z: GAMEPLAY_Z, color: GAMEPLAY_COLOR }))
  scene.add(createTileLayer({ count: BG_TILE_COUNT, z: BG_Z, color: BG_COLOR }))
  scene.add(createTileLayer({ count: FG_TILE_COUNT, z: FG_Z, color: FG_COLOR }))
  scene.add(createPlayerCapsule())
  const { directional, hemisphere } = createLights()
  scene.add(directional, hemisphere)
  return scene
}

export function getDrawCallCount(renderer: DrawCallSource): number {
  return renderer.info.render.calls
}
