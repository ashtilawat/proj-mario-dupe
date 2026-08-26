import * as THREE from 'three'
import { createInput, createLoop } from './engine/index.ts'
import type { Loop } from './engine/index.ts'
import { createDashInput, createPlayer } from './entities/player/index.ts'
import type { Player } from './entities/player/index.ts'
import { createWalker } from './entities/enemies/walker.ts'
import type { Walker } from './entities/enemies/walker.ts'
import { createCoin } from './entities/pickups/index.ts'
import type { Coin } from './entities/pickups/index.ts'
import { createBossStandin } from './entities/bosses/standin.ts'
import type { BossFacing, BossStandin } from './entities/bosses/standin.ts'
import { createFlag } from './entities/goal/index.ts'
import type { Flag } from './entities/goal/index.ts'
import { playSfx } from './audio/index.ts'
import { decodeTiles, loadLevel } from './levels/index.ts'
import type { Level } from './levels/index.ts'
import { TILE_SIZE, overlaps } from './physics/index.ts'
import type { Aabb, TileGrid, TileKind } from './physics/index.ts'
import {
  GAMEPLAY_Z,
  SKY_COLOR,
  UNDERGROUND_SKY_COLOR,
  applyTileArt,
  createBackdrop,
  createLights,
  tileColorAt,
} from './render/index.ts'
// Aliased: `title` is also the name of the live card below, and the story module owns the
// copy while `createTitle` owns the DOM.
import { title as storyTitle } from './story/index.ts'
import { createHud, createTitle } from './ui/index.ts'
import type { Hud, Title } from './ui/index.ts'
import { createDebugOverlay, parseLevelHash } from './debug/index.ts'
import type { DebugBody, DebugOverlay } from './debug/index.ts'

/** Vertical size of the orthographic frustum, in world units. */
export const FRUSTUM_HEIGHT = 10

/** Distance the camera is pulled back along +Z so the origin is in front of it. */
export const CAMERA_DISTANCE = 20

/** The clear color, and with an empty scene the only thing on screen. Sky, not void. */
export const BACKGROUND_COLOR = SKY_COLOR

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

/**
 * The level `hash` actually names, or null for a hash that names none: missing, unreadable,
 * or an id the loader does not know. Probing with `loadLevel` is how that last one is settled
 * here rather than at the call site — no URL a player can type should be able to hand
 * `applyLevel` an id that throws halfway through swapping the world out.
 *
 * Null is the whole point of this returning what it does. A boot turns it into START_LEVEL
 * below, because a fresh load has to land somewhere. A warp must NOT: see `onHashChange`.
 */
function warpTarget(hash: string): string | null {
  const id = parseLevelHash(hash)
  if (!id) return null
  try {
    loadLevel(id)
  } catch {
    return null
  }
  return id
}

/**
 * The level a boot lands on: whatever `#level=<id>` names, when the loader knows it, and
 * World 1-1 for every hash that names nothing.
 *
 * Deliberately not consulted by `restart`: the end cards always go back to START_LEVEL, so
 * a hash-booted run that ends still starts over at 1-1.
 */
function hashLevel(hash: string): string {
  return warpTarget(hash) ?? START_LEVEL
}

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
 *
 * Grass and dirt are per-instance colors rather than two meshes, so the batch stays one
 * draw call. The material is therefore white: three multiplies it into the instance color,
 * and any tint here would darken the whole palette.
 */
export function createTileMesh(grid: TileGrid): THREE.InstancedMesh {
  let count = 0
  for (let ty = 0; ty < grid.height; ty += 1) {
    for (let tx = 0; tx < grid.width; tx += 1) {
      if (grid.getTile(tx, ty) === 'solid') count += 1
    }
  }

  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = 'tiles'

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  let i = 0
  for (let ty = 0; ty < grid.height; ty += 1) {
    for (let tx = 0; tx < grid.width; tx += 1) {
      if (grid.getTile(tx, ty) !== 'solid') continue
      dummy.position.set(tx + 0.5, ty + 0.5, GAMEPLAY_Z)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // setColorAt allocates instanceColor on the first call; the scratch Color is copied
      // into the buffer, so reusing it across instances is safe.
      mesh.setColorAt(i, color.setHex(tileColorAt(grid, tx, ty)))
      i += 1
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
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

/** The level entity type the coin factory answers to. */
export const COIN_ENTITY = 'coin'

/**
 * Every coin spawn point in a level, as a collectible. Same `at`-is-the-tile convention the
 * walkers use, so a level places a coin exactly the way it places an enemy.
 */
export function createCoins(level: Level): Coin[] {
  return level.entities
    .filter((entity) => entity.type === COIN_ENTITY)
    .map((entity, index) => createCoin({ x: entity.at[0], y: entity.at[1], id: index }))
}

/**
 * One parent for every coin mesh, scaled for the same reason {@link createWalkerLayer} is:
 * coin art is authored in world units (TILE_SIZE per tile) while this game draws one world
 * unit per tile.
 */
export function createCoinLayer(coins: Coin[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'coins'
  group.scale.setScalar(1 / TILE_SIZE)
  for (const coin of coins) group.add(coin.mesh)
  return group
}

/** The level entity type the boss factory answers to. */
export const BOSS_ENTITY = 'boss'

/**
 * Every boss in a level. World 1 only gives one to the castle, and most levels have none at
 * all — the empty array is the normal case, not an error.
 */
export function createBosses(level: Level): BossStandin[] {
  return level.entities
    .filter((entity) => entity.type === BOSS_ENTITY)
    .map((entity, index) => {
      const dir: BossFacing = entity.props?.dir === -1 ? -1 : 1
      return createBossStandin({ x: entity.at[0], y: entity.at[1], dir, id: index })
    })
}

/** One parent for every boss mesh, tile-scaled like the walker and coin layers. */
export function createBossLayer(bosses: BossStandin[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'bosses'
  group.scale.setScalar(1 / TILE_SIZE)
  for (const boss of bosses) group.add(boss.mesh)
  return group
}

/** The level entity type the flag reader answers to: a level's exit. */
export const FLAG_ENTITY = 'flag'

/**
 * Every flag in a level, as a hitbox. Levels place a flag by its tile the same way they
 * place a walker, so the AABB follows the walker convention: one tile, anchored on `at`.
 */
export function createFlags(level: Level): Aabb[] {
  return level.entities
    .filter((entity) => entity.type === FLAG_ENTITY)
    .map((entity) => ({ x: entity.at[0], y: entity.at[1], w: 1, h: 1 }))
}

/**
 * Art for the flags the run loop already collides against. Built from the AABBs
 * {@link createFlags} returned rather than from a second pass over the level entities, so a
 * pole can never end up standing on a tile the hitbox is not on.
 */
export function createFlagArt(flags: readonly Aabb[]): Flag[] {
  return flags.map((flag, index) => createFlag({ x: flag.x, y: flag.y, id: index }))
}

/**
 * One parent for every flag mesh, scaled for the same reason {@link createWalkerLayer} is:
 * flag art is authored in world units (TILE_SIZE per tile) while this game draws one world
 * unit per tile.
 */
export function createFlagLayer(art: Flag[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'flags'
  group.scale.setScalar(1 / TILE_SIZE)
  for (const flag of art) group.add(flag.mesh)
  return group
}

/**
 * Where each level's flag leads. A level with no entry — the castle at the end of World 1,
 * or anything the level loader does not know yet — finishes the run instead.
 */
export const NEXT_LEVEL: Record<string, string> = {
  '1-1': '1-2',
  '1-2': '1-3',
  '1-3': '1-4',
  '1-4': '1-5',
  '1-5': '1-6',
  '1-6': '1-castle',
}

/** Lives a run starts with, and what an Enter restart puts back on the HUD. */
export const START_LIVES = 3

/** End-card copy. A run only ever ends one of two ways. */
export const GAME_OVER_TEXT = 'GAME OVER'
export const WIN_TEXT = 'YOU WIN'

/** The card sits above the HUD, which owns z-index 10. */
export const END_OVERLAY_Z_INDEX = 20

/** What the run is doing. Anything but `playing` freezes the simulation. */
type RunMode = 'playing' | 'gameover' | 'win'

interface EndOverlay {
  readonly element: HTMLElement
  show(mode: Exclude<RunMode, 'playing'>, text: string): void
  hide(): void
  dispose(): void
}

/**
 * The GAME OVER / YOU WIN card. Local DOM on purpose: `src/ui` owns the persistent HUD,
 * while this is one game mode's end screen. One node with two texts rather than two nodes,
 * and it stays mounted while hidden so the card is queryable at any point in a run.
 */
function createEndOverlay(): EndOverlay {
  const root = document.createElement('div')
  root.dataset.gameOverlay = ''
  root.dataset.mode = 'playing'
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'polite')
  root.style.position = 'absolute'
  root.style.inset = '0'
  root.style.zIndex = String(END_OVERLAY_Z_INDEX)
  root.style.pointerEvents = 'none'
  root.style.display = 'none'
  root.style.alignItems = 'center'
  root.style.justifyContent = 'center'
  root.style.background = 'rgba(0, 0, 0, 0.55)'
  root.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  root.style.fontSize = '40px'
  root.style.fontWeight = '700'
  root.style.letterSpacing = '0.12em'
  root.style.color = '#fff'
  root.style.textShadow = '0 2px 0 #000'

  const label = document.createElement('span')
  label.dataset.gameOverlayText = ''
  root.append(label)

  return {
    element: root,
    show(mode, text) {
      label.textContent = text
      root.dataset.mode = mode
      root.style.display = 'flex'
    },
    hide() {
      label.textContent = ''
      root.dataset.mode = 'playing'
      root.style.display = 'none'
    },
    dispose() {
      root.remove()
    },
  }
}

export interface Game {
  app: App
  scene: THREE.Scene
  player: Player
  walkers: Walker[]
  coins: Coin[]
  bosses: BossStandin[]
  hud: Hud
  title: Title
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
  // T-048, and the FIRST thing this function does, deliberately: the level a run boots on is
  // frozen from the address bar before anything else has had a chance to run. The read used
  // to happen at the bottom of `startGame`, after the renderer, the canvas and the whole
  // scene were built — and live, something outside this bundle cleared the hash inside that
  // window, so a `#level=1-castle` boot came up as 1-1. Nothing in src writes `location.hash`
  // (this and `onHashChange` are the only reads of it), so the game cannot stop the strip.
  // It can refuse to be timed out by it.
  const bootHash = window.location.hash

  const app = boot(container, createRenderer, size)
  const { scene, camera } = app

  // Everything a level owns is replaced wholesale by `applyLevel`. The player is not:
  // `createPlayer` captures its grid once and there is no setter, so what it collides
  // against is a stable proxy over whichever level is loaded. That is what lets a flag
  // swap the world out from under a running player without rebuilding them.
  let currentId = START_LEVEL
  let level = loadLevel(START_LEVEL)
  let tileGrid = createTileGridFromLevel(START_LEVEL)
  let tiles: THREE.InstancedMesh | undefined
  let flags: Aabb[] = []
  let spawnX = level.spawn[0]
  let spawnY = level.spawn[1]
  let checkpointX = level.checkpoint[0]
  let checkpointY = level.checkpoint[1]
  /**
   * Latched by walking past the checkpoint: from there on a pit fall costs a life but not
   * the ground already covered. Every level load clears it, so a fresh 1-1 — booted or
   * restarted — always sends the player back to the spawn.
   */
  let latched = false

  const grid: TileGrid = {
    get width() {
      return tileGrid.width
    },
    get height() {
      return tileGrid.height
    },
    get tileSize() {
      return tileGrid.tileSize
    },
    getTile(tx, ty) {
      return tileGrid.getTile(tx, ty)
    },
  }

  const { directional, hemisphere } = createLights()
  // Hills and clouds, built once for the whole run. Deliberately not rebuilt by
  // `applyLevel`: the art carries no level-specific state, so swapping worlds would churn
  // GPU objects for an identical picture.
  const backdrop = createBackdrop()
  // T-041 authored the layer against a camera centred on y = 0; `followPlayer` parks the live
  // one at CAMERA_Y and never moves it off. Lifting the group by exactly that much reconciles
  // the two frames — without it the near hill row tops out below the frustum floor and never
  // draws at all. A constant, not a per-frame update: the camera's Y is fixed.
  backdrop.position.y = CAMERA_Y
  const player = createPlayer({ x: spawnX, y: spawnY, grid })
  const overlay = createDebugOverlay()
  // Filled by `applyLevel`, never reassigned: these arrays are the ones handed out on Game.
  const walkers: Walker[] = []
  const coins: Coin[] = []
  const bosses: BossStandin[] = []
  // Art only. `flags` above stays the one array the run loop tests overlaps against.
  const flagArt: Flag[] = []
  const walkerLayer = createWalkerLayer(walkers)
  const coinLayer = createCoinLayer(coins)
  const bossLayer = createBossLayer(bosses)
  const flagLayer = createFlagLayer(flagArt)
  scene.add(
    // `createBackdrop` parks itself at BG_Z, far behind the tile batch at GAMEPLAY_Z, so
    // depth is what keeps it in the back — its place in this list carries no meaning.
    backdrop,
    directional,
    hemisphere,
    player.mesh,
    walkerLayer,
    coinLayer,
    bossLayer,
    flagLayer,
    overlay.group,
  )

  const hud = createHud()
  hud.mount(container)

  // After the HUD, which is what gives a static container its `position: relative`.
  const endOverlay = createEndOverlay()
  container.appendChild(endOverlay.element)

  // Last, so the curtain sits on top of the end card as well as the HUD: both of those use
  // z-index 20, and DOM order is what breaks the tie. `createTitle` starts visible, and
  // `title.visible` IS this run's "not started yet" flag — a second boolean could drift.
  const title = createTitle({ heading: storyTitle })
  title.mount(container)

  const input = createInput()
  const dash = createDashInput()
  input.attach(window)
  dash.attach(window)

  // Reused every frame so a 120 Hz loop allocates nothing for the overlay.
  const debugVelocity = { vx: 0, vy: 0 }
  const debugBodies: DebugBody[] = [{ aabb: player.body.aabb, velocity: debugVelocity }]

  /**
   * Mercy window after a side hit, in seconds, and how much of it is left. Deliberately a
   * run-local value rather than a physics constant: it is a rule of this game mode, not a
   * property of the simulation.
   */
  const HIT_IFRAMES_S = 1
  let invuln = 0

  /**
   * T-037. The walkers whose CURRENT overlap with the player has already been accounted
   * for. A walker can only bill on the frame its overlap begins, so one contact costs one
   * life however long it lasts — `invuln` alone could not do this, because it is a plain
   * wall-clock timer and a walker turning on a ledge can stay inside a standing player for
   * longer than the window (T-034 measured 1.525 s at x = 13.8, which billed twice).
   *
   * The two are not redundant: the latch scopes a bill to one contact, while `invuln`
   * scopes it to one moment, which is what keeps a jump into SEVERAL walkers at one life.
   *
   * Keyed on the walker itself, never `walker.id` — ids are per-level array indices and
   * collide across levels.
   *
   * T-038. The value is how long that walker has been CLEAR of the player, in seconds — 0
   * while they are touching. T-037 released the latch on the first frame the AABBs came
   * apart, which read every gap as the end of the contact; but the 1-1 walker's pit-rim turn
   * puts a gap of a couple of frames in the middle of one bump, and the player standing
   * where the pit jump lands (x ~ 14.2) was billed again the moment it walked back in. So
   * the latch now outlives the gap and only lifts after CONTACT_RELEASE_S of clear air.
   */
  const billed = new Map<Walker, number>()

  /**
   * How long the player must stay clear of a walker before the next touch counts as a new
   * contact rather than the same one. Tied to the mercy window on purpose: a bump the
   * player has not yet walked a full window away from is still that bump. Below this, the
   * walker turning around on a ledge reads as leaving and coming back.
   */
  const CONTACT_RELEASE_S = HIT_IFRAMES_S

  /**
   * Last tick's jump button, so the jump sting can find the press edge. See `simulate` — and
   * `onSpaceDown`, which primes it so a keyboard press is not chirped twice.
   */
  let prevJump = false

  /** Space held right now, so a keydown auto-repeat cannot chirp twice for one press. */
  let spaceHeld = false

  let mode: RunMode = 'playing'

  /**
   * Swaps the whole world over to `id`: tiles, walkers, flags, spawn and checkpoint, with
   * the player put down on the new spawn at rest. Throws for a level the loader does not
   * know — `loadLevel` runs first, so a failed swap leaves the current level untouched.
   */
  function applyLevel(id: string): void {
    const next = loadLevel(id)
    currentId = id
    level = next
    tileGrid = createTileGridFromLevel(id)

    if (tiles) {
      tiles.geometry.dispose()
      ;(tiles.material as THREE.Material).dispose()
      // Also releases the instanceMatrix and instanceColor buffers: three drops those from
      // its attribute cache on the InstancedMesh dispose event, not on the material's.
      tiles.dispose()
      tiles.removeFromParent()
      // Deliberately NOT disposing `material.map`. Themes share one memoized texture, so it
      // outlives any single batch by design — freeing it here would pull the art out from
      // under the next level load, and out from under a later startGame.
    }
    tiles = createTileMesh(grid)
    // Here rather than inside createTileMesh, which is handed a grid and has no theme to
    // read. Applying it per level load is also what makes the art follow the level being
    // swapped in instead of the one the run booted on. Only `material.map` is touched, so
    // the grayscale ground art multiplies with the grass/dirt instance colors set above.
    applyTileArt(tiles, level.theme)
    scene.add(tiles)

    // The other two things a theme owns, both of them outside the tile batch. Here rather
    // than once at boot so they follow every swap — a flag walk 1-2 → 1-3 has to go dark and
    // 1-3 → 1-4 has to come back, and neither of those reloads the page.
    //
    // Only `underground` moves the sky. Castle is its own theme and keeps the blue: the
    // clear color is not what makes a castle read as one, and the tile art already does.
    scene.background = new THREE.Color(
      level.theme === 'underground' ? UNDERGROUND_SKY_COLOR : BACKGROUND_COLOR,
    )
    // Hidden rather than rebuilt or unparented: the group is built once for the whole run
    // (see `createBackdrop` above) and carries no level state, so a theme swap is a flag
    // flip. Grass-only because that is what the art is — hills and clouds have no business
    // standing behind a castle, and none at all underground.
    backdrop.visible = level.theme === 'grass'

    for (const walker of walkers) {
      walker.mesh.geometry.dispose()
      walker.mesh.material.dispose()
      walker.mesh.removeFromParent()
    }
    // Spliced rather than reassigned: `walkers` is the array on Game, and the simulation
    // and its callers hold that same reference. Fresh walkers are also the level reset —
    // a stomped walker comes back alive, on its spawn, facing the way the level says.
    walkers.splice(0, walkers.length, ...createWalkers(level))
    for (const walker of walkers) walkerLayer.add(walker.mesh)
    // With the old walkers gone, every latched contact is over by definition. The latch is
    // keyed on the walker itself, so the fresh ones are already unlatched and this changes
    // no behaviour — it is here so the map cannot hold disposed walkers for a whole run.
    // Here rather than in `restart` so a mid-run level swap clears it too.
    billed.clear()

    // Coins and bosses follow the walkers exactly: dispose the old set, splice the shared
    // array in place, re-hang the meshes. Most levels have no boss, so `bosses` is usually
    // an empty splice — the cheapest possible no-op.
    for (const coin of coins) {
      coin.mesh.geometry.dispose()
      coin.mesh.material.dispose()
      coin.mesh.removeFromParent()
    }
    coins.splice(0, coins.length, ...createCoins(level))
    for (const coin of coins) coinLayer.add(coin.mesh)

    for (const boss of bosses) {
      boss.mesh.geometry.dispose()
      boss.mesh.material.dispose()
      boss.mesh.removeFromParent()
    }
    bosses.splice(0, bosses.length, ...createBosses(level))
    for (const boss of bosses) bossLayer.add(boss.mesh)

    flags = createFlags(level)
    // Flag art follows the same dispose-splice-rehang shape, one step behind the hitboxes
    // it is built from. `Flag.dispose` unparents itself, so the layer is empty by the end
    // of the first loop.
    for (const flag of flagArt) flag.dispose()
    flagArt.splice(0, flagArt.length, ...createFlagArt(flags))
    for (const flag of flagArt) flagLayer.add(flag.mesh)

    spawnX = level.spawn[0]
    spawnY = level.spawn[1]
    checkpointX = level.checkpoint[0]
    checkpointY = level.checkpoint[1]
    latched = false

    player.body.aabb.x = spawnX
    player.body.aabb.y = spawnY
    player.body.velocity.x = 0
    player.body.velocity.y = 0
  }

  /** Freezes the run and raises the card that says how it ended. */
  function endRun(next: Exclude<RunMode, 'playing'>): void {
    mode = next
    endOverlay.show(next, next === 'win' ? WIN_TEXT : GAME_OVER_TEXT)
  }

  /**
   * One life gone. Spending the last one ends the run — and takes the gameover sting with
   * it instead of the death sting, so the two never stack on the same frame.
   */
  function loseLife(): void {
    hud.setLives(hud.getState().lives - 1)
    if (hud.getState().lives === 0) {
      playSfx('gameover')
      endRun('gameover')
      return
    }
    playSfx('death')
  }

  /**
   * Took the flag. The next level in the chain is loaded when there is one and the loader
   * knows it; otherwise the run is over and won. Only World 1-1 is registered today, so
   * every flag currently wins the game — 1-2 onwards will fall out of this path for free.
   */
  function advance(): void {
    const nextId = NEXT_LEVEL[currentId]
    if (nextId === undefined) {
      endRun('win')
      return
    }
    try {
      applyLevel(nextId)
    } catch {
      endRun('win')
    }
  }

  /** Enter on an end card: World 1-1 from the top, whichever level the run ended on. */
  function restart(): void {
    hud.setLives(START_LIVES)
    // Coins are a run total, so a fresh run starts on nothing — same reasoning as lives.
    hud.setCoins(0)
    invuln = 0
    applyLevel(START_LEVEL)
    endOverlay.hide()
    mode = 'playing'
  }

  /**
   * The jump chirp for a keyboard press, fired from the gesture itself rather than from the
   * loop. Browsers hand back a SUSPENDED AudioContext to anything that opens one outside a user
   * gesture, and `playSfx` opens it on its first call — so a chirp that only ever came from a
   * requestAnimationFrame callback made no sound at all on a real page.
   *
   * Priming `prevJump` is what stops `simulate` chirping this same press a second time. A
   * gamepad jump has no keydown, so it still finds its edge there.
   */
  function onSpaceDown(): void {
    // Held keys repeat their keydown; one press is one chirp.
    if (spaceHeld) return
    spaceHeld = true
    // Same freeze rule the loop follows: no chirp for a Space pressed into a card.
    if (title.visible || mode !== 'playing') return
    playSfx('jump')
    prevJump = true
  }

  // The engine's InputState has no Enter — it is a menu key, not a movement one — so the
  // cards listen for themselves. Two of them share the key now, and the order below is the
  // whole rule: the title always wins it, so an end card can only ever answer to Enter once
  // the title is down. Between the two, Enter is inert while a run is being played.
  //
  // Space is handled here as well, for the audio-context reason in `onSpaceDown` — the engine
  // still owns it as a movement key, and this listener never touches the input state.
  function onKeydown(event: KeyboardEvent): void {
    // T-046. `code` is the physical key the engine and the jump chirp both read; `key` is
    // the character, which is all a layout with no Space code — or a synthetic press — ever
    // sends. The chirp stays on the physical key, because all it does is prime the jump edge
    // the engine finds on that same key. But BOTH shapes stop here: Space is the jump key
    // and nothing else, and neither shape may fall through to the card key below.
    if (event.code === 'Space') onSpaceDown()
    if (event.code === 'Space' || event.key === ' ') {
      // A frozen run has no jump for Space to be, so the browser's own default is the only
      // thing left that can act on the press: scrolling the frame the game sits in, or
      // firing whatever control holds focus. Either one reads as the card being dismissed
      // by Space, over a run the game still has frozen behind it. Enter ends a card; this
      // is what keeps Space from looking like it does.
      if (title.visible || mode !== 'playing') event.preventDefault()
      return
    }
    if (event.key !== 'Enter') return
    if (title.visible) {
      // Before `hide`, and the reason it is here rather than anywhere prettier: this is the
      // first user gesture of every run, so it is the one moment the game can open a RUNNING
      // audio context. Every later sound — jump, death, gameover — plays through the context
      // this call opens. The fanfare doubles as the run's start sting.
      playSfx('flag')
      title.hide()
      return
    }
    if (mode === 'playing') return
    restart()
  }

  function onKeyup(event: KeyboardEvent): void {
    if (event.code === 'Space') spaceHeld = false
  }

  /**
   * A warp: the address bar changed, so the world follows it — when the new hash names a
   * level. A link pasted mid-run therefore lands on exactly the level it would have booted
   * into. The title card is not touched either way: on boot it is still up over the frozen
   * opening pose, and mid-run it is already down.
   *
   * T-048. A hash naming NO level is not a warp instruction and no longer moves the run.
   * This used to read `hashLevel()`, so an empty hash — a strip, a `#` from some control on
   * the page, anything at all — meant START_LEVEL, and one of those was enough to drop a
   * warped run onto 1-1 grass. That is the bug QA saw, and it is not the parser's: the hash
   * had already been emptied by the time this ran.
   *
   * The run also puts its own level back in the address bar, so the URL keeps naming where
   * the player actually is. `replaceState` rather than `location.hash =`, which would fire
   * another hashchange straight back into here.
   *
   * 1-1 restores too, and that is the case it was written for. QA saw GAME OVER on 1-1 throw
   * itself back to the title about half a second later with nobody touching a key, which is
   * what a fresh load of `/` looks like. This handler cannot do that — it loads no level,
   * raises no title and restarts nothing on a strip — but it CAN stop leaving a bare URL
   * behind on the one level every GAME OVER sits on. Skipping the restore on 1-1 because a
   * bare URL boots there anyway is exactly backwards.
   */
  function onHashChange(): void {
    const target = warpTarget(window.location.hash)
    if (target !== null) {
      applyLevel(target)
      return
    }
    window.history.replaceState(window.history.state, '', `#level=${currentId}`)
  }

  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('hashchange', onHashChange)

  applyLevel(hashLevel(bootHash))

  const loop = createLoop({
    input,
    simulate(dt, state) {
      // A card is up, so the world stops where it stood: no stepping, no combat, no pit, no
      // flag. `render` keeps running, and draws that frozen frame under the card. The title
      // is the same freeze as an end card, just at the other end of the run — which is what
      // makes the boot frame the level's untouched opening pose.
      if (title.visible || mode !== 'playing') {
        // Consume the jump edge even while frozen so a Space held through the title
        // does not chirp the moment the run starts.
        prevJump = state.jump
        return
      }

      // The jump chirp rides the input's own rising edge rather than an actual launch:
      // player.ts owns the launch and is not ours to touch. `simulate` is handed the SAME
      // InputState object for every fixed step in a frame, so this fires at most once per
      // tick — but it does fire on a mid-air press that no jump comes of.
      //
      // A keyboard press has already chirped from its own keydown and left `prevJump` true, so
      // what actually reaches this line is a gamepad button: the pad has no keydown to ride.
      if (state.jump && !prevJump) playSfx('jump')
      prevJump = state.jump

      // tryStomp judges the stomper by where their feet were and which way they were moving
      // BEFORE this step, and nothing on the player records either — so capture both here.
      // Reading the velocity afterwards is wrong: a landing zeroes vy inside moveAndCollide,
      // so the very stomp that touched down looked like vy >= 0 and the player stood on the
      // walker like a platform.
      //
      // Captured once, outside the walker loop, for a second reason: every walker under the
      // player this tick was stomped by the same fall, and the first bounce would otherwise
      // overwrite velocity.y with a positive value, masking every later walker's stomp behind
      // its own stomperVy >= 0 guard — making the outcome depend on walker array order.
      const prevBottom = player.body.aabb.y
      const prevVy = player.body.velocity.y
      player.step(dt, dash.poll(state))

      // Passing the checkpoint is one-way for the rest of the level.
      if (player.body.aabb.x >= checkpointX) latched = true

      for (const walker of walkers) walker.step(dt, grid)
      for (const boss of bosses) boss.step(dt, grid)
      // T-044 — every coin in the level, not just one the player happens to be touching:
      // the idle spin is what makes a disc read as a pickup from across the room. `step` is
      // rotation only and self-guards on `collected`, so this cannot move a hitbox or
      // disturb the pickup pass below. Under the freeze above, it does not run at all — a
      // card stops the coins the same way it stops the walkers.
      for (const coin of coins) coin.step(dt)

      // Pickups, before combat: touching a coin is never contested by anything else, and
      // `collect` is the one-shot latch, so the score cannot double-count an overlap that
      // spans several frames. `collected` is only an early-out for the disc already taken.
      for (const coin of coins) {
        if (coin.collected) continue
        if (!overlaps(player.body.aabb, coin.aabb)) continue
        if (!coin.collect()) continue
        hud.setCoins(hud.getState().coins + 1)
        playSfx('coin')
      }

      // A stomp is the walker's call: it checks the fall direction and the overlap, then
      // hands back the bounce to spend. Defeated walkers just stop being drawn. An overlap
      // that is NOT a stomp is a side hit and costs a life — once per contact, and at most
      // once per i-frame window. The window is armed on the spot, so a second walker
      // overlapping in this same tick cannot bill a second life for one jump.
      for (const walker of walkers) {
        const bounce = walker.tryStomp(player.body.aabb, prevVy, prevBottom)
        if (bounce !== 0) {
          player.body.velocity.y = bounce
          walker.mesh.visible = false
          playSfx('stomp')
          continue
        }
        // Not touching, or not a threat any more. The contact is NOT over yet: a walker
        // reversing on a ledge steps out of the player and straight back in, and T-037
        // released here, on that first clear frame, so the walk back in bought a second
        // life. Age the latch instead, and only lift it once the player has been clear for
        // a whole CONTACT_RELEASE_S — that, not a single frame apart, is a separation.
        // A stomped walker ages out down this same path.
        if (!walker.alive || !overlaps(player.body.aabb, walker.aabb)) {
          const clearFor = billed.get(walker)
          if (clearFor === undefined) continue
          const next = clearFor + dt
          if (next >= CONTACT_RELEASE_S) billed.delete(walker)
          else billed.set(walker, next)
          continue
        }
        // Alive and overlapping, so any clear time it had banked is spent: the contact is
        // live again, and the next gap has to run the full window from here.
        const alreadyBilled = billed.has(walker)
        // Latched BEFORE the window is consulted, deliberately: a walker first touched
        // inside someone else's i-frames is part of that same bump, and leaving it
        // unlatched would let it bill the instant the window lapsed — the very bug this
        // latch exists to close, just spread over two walkers instead of one.
        billed.set(walker, 0)
        // Only the frame the overlap BEGINS can bill.
        if (alreadyBilled) continue
        if (invuln > 0) continue
        loseLife()
        invuln = HIT_IFRAMES_S
      }

      // Same stomp rule as walkers. Side contact is intentionally not a life: wiring
      // the stand-in's damage would change the castle fight, which this ticket is not.
      for (const boss of bosses) {
        const bounce = boss.tryStomp(player.body.aabb, prevVy, prevBottom)
        if (bounce !== 0) {
          player.body.velocity.y = bounce
          playSfx('stomp')
          if (!boss.alive) boss.mesh.visible = false
        }
      }

      invuln = Math.max(0, invuln - dt)

      // Fell out of the level: nothing below y=0 can ever catch the body, so the fall
      // costs a life and puts the player back at rest on the checkpoint if they reached
      // it, on the level spawn if they did not. The body moves BEFORE the life is billed:
      // the last life freezes the game on the spot, and that frozen frame should show the
      // respawn point rather than the void the player fell into.
      const aabb = player.body.aabb
      if (aabb.y + aabb.h < 0) {
        aabb.x = latched ? checkpointX : spawnX
        aabb.y = latched ? checkpointY : spawnY
        player.body.velocity.x = 0
        player.body.velocity.y = 0
        loseLife()
      }

      // The level exit. No "already touched" latch is needed: taking a flag either ends the
      // run or moves the player onto the next level's spawn, so the overlap cannot re-fire.
      if (mode !== 'playing') return
      for (const flag of flags) {
        if (!overlaps(aabb, flag)) continue
        // Before `advance`, which may swap the level out or raise the win card: the fanfare
        // belongs to taking the flag either way.
        playSfx('flag')
        advance()
        break
      }
    },
    render() {
      followPlayer(camera, player, grid)
      // Rides the camera, so the ridge never runs out sideways: the hills span roughly ±15.5
      // around the group, wider than the frustum but far narrower than a level. Pinning means
      // zero parallax — a distant sky barely shifts anyway, and the parallax pass that
      // src/render/backdrop.ts anticipates is what turns this constant into a factor.
      backdrop.position.x = camera.position.x
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
    coins,
    bosses,
    hud,
    title,
    loop,
    grid,
    overlay,
    dispose() {
      loop.stop()
      input.detach()
      dash.detach()
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
      window.removeEventListener('hashchange', onHashChange)
      overlay.dispose()
      endOverlay.dispose()
      title.unmount()
      hud.unmount()
      if (tiles) {
        tiles.geometry.dispose()
        ;(tiles.material as THREE.Material).dispose()
        // Also releases the instanceMatrix and instanceColor buffers: three drops those
        // from its attribute cache on the InstancedMesh dispose event, not the material's.
        tiles.dispose()
        tiles.removeFromParent()
      }
      for (const walker of walkers) {
        walker.mesh.geometry.dispose()
        walker.mesh.material.dispose()
      }
      for (const coin of coins) {
        coin.mesh.geometry.dispose()
        coin.mesh.material.dispose()
      }
      for (const boss of bosses) {
        boss.mesh.geometry.dispose()
        boss.mesh.material.dispose()
      }
      for (const flag of flagArt) flag.dispose()
      // The group shares one geometry across every hill and one material across every cloud,
      // so the sets are what keep this from disposing the shared ones over and over. The
      // counts themselves deliberately stay in src/render/backdrop.ts.
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      backdrop.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        geometries.add(object.geometry)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material)
        }
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      backdrop.removeFromParent()
      walkerLayer.removeFromParent()
      coinLayer.removeFromParent()
      bossLayer.removeFromParent()
      flagLayer.removeFromParent()
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
