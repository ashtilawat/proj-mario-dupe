import * as THREE from 'three'

/**
 * Procedural tile surface art.
 *
 * The maps are generated as `DataTexture`s rather than `CanvasTexture`s: the test environment
 * (jsdom, no `canvas` backend) hands back a null 2D context, so a canvas generator could
 * neither run nor be pixel-asserted under vitest. Pixels are built by pure functions here, so
 * the art is deterministic, identical in the browser and in tests, and needs no asset pipeline.
 *
 * The ground and underground maps are deliberately grayscale. Three multiplies `material.color *
 * instanceColor * map`, so a grayscale map adds surface detail on top of a per-instance palette
 * instead of replacing it — grass stays green, dirt stays brown, neither stays flat. The brick
 * map is the opposite: it carries its own color, because a castle consumer may have no
 * per-instance tint to give it.
 *
 * Darkness lives in the tint, not in the map: a map that is itself dark, multiplied by a dark
 * tint, crushes toward black under the Lambert plus hemisphere rig. So the underground map
 * shares the ground map's mid band, and `instanceTint` does the darkening.
 */

/** A solid tile with nothing stacked on it: the lit grass surface. */
export const GRASS_TOP_COLOR = 0x57a83a

/** A solid tile buried under another solid tile: packed earth. */
export const DIRT_COLOR = 0x8b5a2b

/** Edge length, in texels, of every tile art map. */
export const TILE_ART_SIZE = 16

/** Floor for the ground map, so a textured tile never crushes toward black. ~0.70 of full. */
export const GROUND_LUMA_FLOOR = 179

/**
 * Floor for the underground map, below the ground floor because the groove cuts deeper. A guard
 * rail rather than an active clamp: the generator bottoms out at 141, one above this. Retuning
 * the groove or the speckle is what it is here to catch.
 */
export const UNDERGROUND_LUMA_FLOOR = 140

/** `Level.theme` value for World 1-1's grass/dirt ground. */
export const GRASS_THEME = 'grass'

/** `Level.theme` value a brick-walled castle level would carry. */
export const CASTLE_THEME = 'castle'

/** `Level.theme` value for World 1-3's underground caves. */
export const UNDERGROUND_THEME = 'underground'

/**
 * Cool slate rock for the underground caves — blue-dominant, the inverse of the warm brick, and
 * darker than either entry of the grass palette. Both the flat tint and the per-instance repaint.
 */
export const UNDERGROUND_ROCK_COLOR = 0x46506b

/**
 * Clear color for the underground theme: a near-black cave void, the counterpart to the render
 * module's grass `SKY_COLOR`. Exported for a future backdrop wire; nothing reads it yet.
 */
export const UNDERGROUND_SKY_COLOR = 0x0a0e1a

/**
 * What castle repaints per-instance colors to. White is the identity of the multiply, so the
 * brick map's own albedo comes through unstained — without this, a mesh still carrying the
 * grass palette from a previous theme would tint the whole wall green.
 */
export const CASTLE_INSTANCE_TINT = 0xffffff

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

const UNDERGROUND_BASE_LUMA = 210

/** Depth of the 1-texel seam cut around the tile, which is what reads as a hewn stone block. */
const UNDERGROUND_GROOVE = -55

/** Coarser than the ground speckle, and applied per 2x2 block: rough rock rather than turf. */
const UNDERGROUND_SPECKLE = [-14, -7, 0, 7]

function undergroundLuma(x: number, y: number): number {
  const onEdge = x === 0 || y === 0 || x === TILE_ART_SIZE - 1 || y === TILE_ART_SIZE - 1
  const groove = onEdge ? UNDERGROUND_GROOVE : 0
  // Hashing the halved coordinate is what makes the grain chunky: one draw per 2x2 texels. The
  // row is folded about the tile's middle first, so row y and row SIZE-1-y come out identical
  // and the map is EXACTLY symmetric top to bottom — "nothing lights this from above" as a
  // property of the generator, not as a statistical near-miss the speckle could break. The fold
  // costs one seam: rows 7 and 8 are mirror partners and must match, which merges rows 6-9 into
  // a single 4-tall band. Unavoidable at an even height with 2-row blocks, and cheaper than
  // giving up either the symmetry or the block size.
  const foldedRow = Math.min(y, TILE_ART_SIZE - 1 - y)
  const speckle = UNDERGROUND_SPECKLE[hash2(x >> 1, foldedRow >> 1) % UNDERGROUND_SPECKLE.length]!
  return clamp(UNDERGROUND_BASE_LUMA + groove + speckle, UNDERGROUND_LUMA_FLOOR, 255)
}

/**
 * Grayscale surface detail for underground rock. Deliberately unlike the ground map: no lit
 * crown, because nothing underground is sun-lit from above, so the tile is vertically
 * symmetric. A dark groove around all four edges separates one block from the next, and the
 * coarse speckle reads as rock. The dark comes from `UNDERGROUND_ROCK_COLOR` multiplying
 * through, not from the map.
 *
 * A fresh texture each call; use `tileArtForTheme` for the shared, memoized one.
 */
export function createUndergroundDetailTexture(): THREE.DataTexture {
  return createArtTexture((x, y) => {
    const luma = undergroundLuma(x, y)
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
  readonly texture: THREE.DataTexture
  /** Flat tint for consumers that cannot carry the map — a distant parallax layer, say. */
  readonly color: number
  /**
   * Per-instance color this theme repaints onto a palette-tinted InstancedMesh, or undefined to
   * keep whatever palette the caller already set. Grass leaves it undefined so World 1-1 keeps
   * its green/brown palette; every other theme owns the tint, because the palette it would
   * otherwise inherit is grass.
   */
  readonly instanceTint?: number
}

// Themes share one texture instance so a level costs one GPU upload per theme, not one per
// mesh. Built lazily: importing this module should not allocate a megabyte of pixels.
const cache = new Map<string, TileArt>()

const KNOWN_THEMES = new Set<string>([GRASS_THEME, CASTLE_THEME, UNDERGROUND_THEME])

/**
 * Tile art for a `Level.theme` string. Grass is the default, so an unknown or missing theme
 * falls through to the ground art rather than rendering untextured.
 */
export function tileArtForTheme(theme: string): TileArt {
  // Resolve to a known theme BEFORE consulting the cache. Keying on the raw string would give
  // every unrecognised theme its own copy of the ground art — a fresh texture per distinct
  // string, none of them shared with grass.
  const key = KNOWN_THEMES.has(theme) ? theme : GRASS_THEME

  const cached = cache.get(key)
  if (cached) return cached

  const art: TileArt = buildTileArt(key)
  cache.set(key, art)
  return art
}

function buildTileArt(key: string): TileArt {
  if (key === CASTLE_THEME) {
    return {
      texture: createBrickTexture(),
      color: CASTLE_BRICK_COLOR,
      instanceTint: CASTLE_INSTANCE_TINT,
    }
  }
  if (key === UNDERGROUND_THEME) {
    return {
      texture: createUndergroundDetailTexture(),
      color: UNDERGROUND_ROCK_COLOR,
      instanceTint: UNDERGROUND_ROCK_COLOR,
    }
  }
  return { texture: createGroundDetailTexture(), color: GRASS_TOP_COLOR }
}

/**
 * Maps a theme's tile art onto a mesh's material(s), in place, and repaints the per-instance
 * palette when the theme owns one.
 *
 * `material.color` is never touched — a caller's flat layer color survives. `instanceColor` is
 * only ever overwritten, never allocated: creating the buffer here would silently override the
 * `color` a consumer chose for a mesh that deliberately has no per-instance palette.
 *
 * Grass declares no `instanceTint`, so the grass/dirt palette is left exactly as the caller set
 * it and the grayscale ground map multiplies with those hues. Every other theme repaints,
 * because the palette it would otherwise inherit — from a mesh built for World 1-1 — is green.
 */
export function applyTileArt<T extends THREE.Mesh>(mesh: T, theme: string = GRASS_THEME): T {
  const { texture, instanceTint } = tileArtForTheme(theme)
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

  for (const material of materials) {
    if (!('map' in material)) continue
    ;(material as THREE.MeshLambertMaterial).map = texture
    material.needsUpdate = true
  }

  if (instanceTint !== undefined && mesh instanceof THREE.InstancedMesh && mesh.instanceColor) {
    const color = new THREE.Color().setHex(instanceTint)
    // Bound by the buffer, not by `mesh.count`: count is three's knob for drawing a prefix of
    // the batch, so painting only that far would leave the tail its old palette — green again
    // the moment count goes back up.
    for (let i = 0; i < mesh.instanceColor.count; i += 1) mesh.setColorAt(i, color)
    mesh.instanceColor.needsUpdate = true
  }
  return mesh
}
