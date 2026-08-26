import * as THREE from 'three'

/**
 * Procedural tile surface art.
 *
 * The maps are generated as `DataTexture`s rather than `CanvasTexture`s: the test environment
 * (jsdom, no `canvas` backend) hands back a null 2D context, so a canvas generator could
 * neither run nor be pixel-asserted under vitest. Pixels are built by pure functions here, so
 * the art is deterministic, identical in the browser and in tests, and needs no asset pipeline.
 *
 * The ground map is deliberately grayscale. Three multiplies `material.color * instanceColor *
 * map`, so a grayscale map adds surface detail on top of the existing per-instance palette
 * instead of replacing it — grass stays green, dirt stays brown, neither stays flat. The brick
 * map is the opposite: it carries its own color, because a castle consumer may have no
 * per-instance tint to give it.
 *
 * NOT YET WIRED TO ANYTHING ON SCREEN. `createTileMesh` in main.ts builds its own material
 * inline and never asks for a map, so gameplay tiles still render as flat hex fills. Closing
 * that is a one-line `applyTileArt(tiles, level.theme)` in main.ts, which is outside this
 * module's scope. The only in-repo consumer is `createTileLayer`, which is reached solely from
 * `createRenderScene` — the M0 blockout scene, which main.ts does not call. So until that
 * one-liner lands, this art is exercised by tests and by nothing else.
 */

/** A solid tile with nothing stacked on it: the lit grass surface. */
export const GRASS_TOP_COLOR = 0x57a83a

/** A solid tile buried under another solid tile: packed earth. */
export const DIRT_COLOR = 0x8b5a2b

/** Edge length, in texels, of every tile art map. */
export const TILE_ART_SIZE = 16

/** Floor for the ground map, so a textured tile never crushes toward black. ~0.70 of full. */
export const GROUND_LUMA_FLOOR = 179

/** `Level.theme` value for World 1-1's grass/dirt ground. */
export const GRASS_THEME = 'grass'

/** `Level.theme` value a brick-walled castle level would carry. */
export const CASTLE_THEME = 'castle'

/**
 * Flat fallback tint for castle tiles, for consumers that want a single hex rather than the
 * map — the castle counterpart to GRASS_TOP_COLOR. Matches the brick face in the map itself.
 */
export const CASTLE_BRICK_COLOR = 0xb25a44

type Rgb = readonly [number, number, number]

/**
 * Integer hash over a texel coordinate. `Math.random` is off limits here: the art has to come
 * out byte-identical on every call so it can be asserted texel by texel.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663)
  h ^= h >>> 13
  h = Math.imul(h, 1274126177)
  h ^= h >>> 16
  return h >>> 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Builds an RGBA `DataTexture` from a per-texel color function.
 *
 * `DataTexture` sets `flipY = false`, so row 0 of the buffer is v = 0 — the BOTTOM of the tile
 * quad. Both generators below are written in those terms.
 */
function createArtTexture(colorAt: (x: number, y: number) => Rgb): THREE.DataTexture {
  const data = new Uint8Array(TILE_ART_SIZE * TILE_ART_SIZE * 4)
  for (let y = 0; y < TILE_ART_SIZE; y += 1) {
    for (let x = 0; x < TILE_ART_SIZE; x += 1) {
      const [r, g, b] = colorAt(x, y)
      const i = (y * TILE_ART_SIZE + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, TILE_ART_SIZE, TILE_ART_SIZE)
  // Crisp texels rather than a blurred wash, at this size.
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

/** How many rows at the top of the tile read as the lit crown. */
const GROUND_CROWN_ROWS = 3

/** Deterministic per-texel jitter, picked by hash. Never positive enough to blow out the crown. */
const GROUND_SPECKLE = [-8, -4, 0, 4]

function groundLuma(x: number, y: number): number {
  const fromTop = TILE_ART_SIZE - 1 - y
  const base =
    fromTop < GROUND_CROWN_ROWS
      ? 250 - fromTop * 6
      : 214 - (fromTop - GROUND_CROWN_ROWS) * 2
  // A slight darkening every fourth column. Subtle by design — at -5 against +/-8 of speckle it
  // breaks up banding rather than reading as visible stripes.
  const grain = x % 4 === 0 ? -5 : 0
  const speckle = GROUND_SPECKLE[hash2(x, y) % GROUND_SPECKLE.length]!
  return clamp(base + grain + speckle, GROUND_LUMA_FLOOR, 255)
}

/**
 * Grayscale surface detail for grass and dirt: a lit crown across the top of the tile, a
 * vertical grain, and speckle. Multiplies with whatever hue the caller has already tinted the
 * tile, so one map serves both palette entries.
 *
 * A fresh texture each call; use `tileArtForTheme` for the shared, memoized one.
 */
export function createGroundDetailTexture(): THREE.DataTexture {
  return createArtTexture((x, y) => {
    const luma = groundLuma(x, y)
    return [luma, luma, luma]
  })
}

const BRICK_COURSE_HEIGHT = 8
const BRICK_LENGTH = 8
const MORTAR_RGB: Rgb = [78, 70, 64]
const BRICK_FACE_RGB: Rgb = [178, 90, 68]
const BRICK_TOP_HIGHLIGHT = 18
const BRICK_SHADES = [-10, 0, 10]

function brickRgb(x: number, y: number): Rgb {
  const course = Math.floor(y / BRICK_COURSE_HEIGHT)
  // Alternate courses shift by half a brick, so head joints never line up between courses:
  // a running bond, which is what reads as brickwork rather than as tile.
  const offset = course % 2 === 0 ? 0 : BRICK_LENGTH / 2

  const onBed = y % BRICK_COURSE_HEIGHT === 0
  const onHeadJoint = (x + offset) % BRICK_LENGTH === 0
  if (onBed || onHeadJoint) return MORTAR_RGB

  // Wrap the index: the offset course splits one brick across the tile seam, so the half at
  // x=0 and the half at x=15 must hash to the SAME brick. Without the modulo they get separate
  // shades and a tiled wall shows a brick that changes color mid-span with no joint in it.
  const bricksPerCourse = TILE_ART_SIZE / BRICK_LENGTH
  const brick = Math.floor((x + offset) / BRICK_LENGTH) % bricksPerCourse
  const shade = BRICK_SHADES[hash2(brick, course) % BRICK_SHADES.length]!
  const highlight = y % BRICK_COURSE_HEIGHT === BRICK_COURSE_HEIGHT - 1 ? BRICK_TOP_HIGHLIGHT : 0
  const [r, g, b] = BRICK_FACE_RGB
  return [
    clamp(r + shade + highlight, 0, 255),
    clamp(g + shade + highlight, 0, 255),
    clamp(b + shade + highlight, 0, 255),
  ]
}

/**
 * Warm brick in a running bond, with a dark mortar bed under each course. Unlike the ground
 * map this one carries its own color, so it reads as brick against an untinted white material.
 *
 * A fresh texture each call; use `tileArtForTheme` for the shared, memoized one.
 */
export function createBrickTexture(): THREE.DataTexture {
  const texture = createArtTexture(brickRgb)
  // This map is albedo, not a multiplier, so it wants the sRGB decode.
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** The art one theme draws its tiles with. */
export interface TileArt {
  /** Surface map for a single tile quad; UV 0..1 covers exactly one tile. */
  texture: THREE.DataTexture
  /** Flat tint for consumers that cannot carry the map — a distant parallax layer, say. */
  color: number
}

// Themes share one texture instance so a level costs one GPU upload per theme, not one per
// mesh. Built lazily: importing this module should not allocate a megabyte of pixels.
const cache = new Map<string, TileArt>()

/**
 * Tile art for a `Level.theme` string. Grass is the default and castle is the exception, so an
 * unknown or missing theme falls through to the ground art rather than rendering untextured.
 */
export function tileArtForTheme(theme: string): TileArt {
  // Resolve to a known theme BEFORE consulting the cache. Keying on the raw string would give
  // every unrecognised theme its own copy of the ground art — a fresh texture per distinct
  // string, none of them shared with grass.
  const key = theme === CASTLE_THEME ? CASTLE_THEME : GRASS_THEME

  const cached = cache.get(key)
  if (cached) return cached

  const art: TileArt =
    key === CASTLE_THEME
      ? { texture: createBrickTexture(), color: CASTLE_BRICK_COLOR }
      : { texture: createGroundDetailTexture(), color: GRASS_TOP_COLOR }
  cache.set(key, art)
  return art
}

/**
 * Maps a theme's tile art onto a mesh's material(s), in place.
 *
 * Deliberately touches only `map`: `material.color` and any `instanceColor` are left exactly
 * as the caller set them, so this is safe to call on a palette-tinted InstancedMesh — the
 * grayscale ground map multiplies with those per-instance hues rather than overriding them.
 */
export function applyTileArt<T extends THREE.Mesh>(mesh: T, theme: string = GRASS_THEME): T {
  const { texture } = tileArtForTheme(theme)
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

  for (const material of materials) {
    if (!('map' in material)) continue
    ;(material as THREE.MeshLambertMaterial).map = texture
    material.needsUpdate = true
  }
  return mesh
}
