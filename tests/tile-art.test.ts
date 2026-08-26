import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  CASTLE_BRICK_COLOR,
  CASTLE_THEME,
  GRASS_THEME,
  GRASS_TOP_COLOR,
  GROUND_LUMA_FLOOR,
  TILE_ART_SIZE,
  applyTileArt,
  createBrickTexture,
  createGroundDetailTexture,
  createTileLayer,
  tileArtForTheme,
} from '../src/render'

interface Texel {
  r: number
  g: number
  b: number
  a: number
}

// Routed through `unknown` on purpose: @types/three types DataTexture.image loosely, and the
// exact declared shape has moved between releases. The runtime value is the Uint8Array the
// generator handed the constructor.
function pixels(texture: THREE.DataTexture): Uint8Array {
  return texture.image.data as unknown as Uint8Array
}

/**
 * `y` is the row index in the pixel array. DataTexture sets `flipY = false`, so row 0 is
 * v = 0 — the BOTTOM of the tile quad — and row SIZE-1 is the top.
 */
function texel(texture: THREE.DataTexture, x: number, y: number): Texel {
  const data = pixels(texture)
  const i = (y * texture.image.width + x) * 4
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! }
}

function luma({ r, g, b }: Texel): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function everyTexel(texture: THREE.DataTexture, visit: (t: Texel, x: number, y: number) => void) {
  for (let y = 0; y < texture.image.height; y += 1) {
    for (let x = 0; x < texture.image.width; x += 1) visit(texel(texture, x, y), x, y)
  }
}

function meanLumaOfRows(texture: THREE.DataTexture, rows: number[]): number {
  let total = 0
  for (const y of rows) {
    for (let x = 0; x < texture.image.width; x += 1) total += luma(texel(texture, x, y))
  }
  return total / (rows.length * texture.image.width)
}

function meanLuma(texture: THREE.DataTexture): number {
  const all = Array.from({ length: texture.image.height }, (_, y) => y)
  return meanLumaOfRows(texture, all)
}

/** Columns in a row dark enough to be a mortar joint rather than a brick face. */
function jointColumns(texture: THREE.DataTexture, y: number): number[] {
  const threshold = meanLuma(texture) - 15
  const columns: number[] = []
  for (let x = 0; x < texture.image.width; x += 1) {
    if (luma(texel(texture, x, y)) < threshold) columns.push(x)
  }
  return columns
}

describe('createGroundDetailTexture', () => {
  test('is a 16x16 RGBA DataTexture flagged for upload', () => {
    const texture = createGroundDetailTexture()

    expect(texture).toBeInstanceOf(THREE.DataTexture)
    expect(TILE_ART_SIZE).toBe(16)
    expect(texture.image.width).toBe(TILE_ART_SIZE)
    expect(texture.image.height).toBe(TILE_ART_SIZE)
    expect(pixels(texture)).toBeInstanceOf(Uint8Array)
    expect(pixels(texture).length).toBe(TILE_ART_SIZE * TILE_ART_SIZE * 4)
    // Texture.needsUpdate is a set-only accessor; the observable effect is the version bump.
    expect(texture.version).toBeGreaterThan(0)
    expect(texture.flipY).toBe(false)

    everyTexel(texture, (t) => expect(t.a).toBe(255))
  })

  test('is grayscale, so it multiplies with the palette instead of replacing it', () => {
    const texture = createGroundDetailTexture()

    everyTexel(texture, (t, x, y) => {
      expect(`${x},${y}:${t.r},${t.g},${t.b}`).toBe(`${x},${y}:${t.r},${t.r},${t.r}`)
    })
  })

  test('is not a flat fill', () => {
    const texture = createGroundDetailTexture()

    const shades = new Set<number>()
    everyTexel(texture, (t) => shades.add(t.r))

    expect(shades.size).toBeGreaterThan(8)
    expect(Math.min(...shades)).toBeLessThan(Math.max(...shades))
  })

  test('never crushes to black or blows out', () => {
    const texture = createGroundDetailTexture()

    everyTexel(texture, (t) => {
      expect(t.r).toBeGreaterThanOrEqual(GROUND_LUMA_FLOOR)
      expect(t.r).toBeLessThanOrEqual(255)
    })
    expect(GROUND_LUMA_FLOOR).toBeGreaterThanOrEqual(Math.round(0.7 * 255))
  })

  test('lights the top of the tile more than the bottom', () => {
    const texture = createGroundDetailTexture()

    // flipY is false, so the high row indices are the top of the quad.
    const top = meanLumaOfRows(texture, [12, 13, 14, 15])
    const bottom = meanLumaOfRows(texture, [0, 1, 2, 3])

    expect(top).toBeGreaterThan(bottom + 20)
  })

  test('is deterministic — no Math.random in the generator', () => {
    expect(Array.from(pixels(createGroundDetailTexture()))).toEqual(
      Array.from(pixels(createGroundDetailTexture())),
    )
  })

  test('hands back a fresh texture each call so callers can dispose independently', () => {
    expect(createGroundDetailTexture()).not.toBe(createGroundDetailTexture())
  })
})

describe('createBrickTexture', () => {
  test('is a 16x16 RGBA DataTexture carrying albedo in sRGB', () => {
    const texture = createBrickTexture()

    expect(texture).toBeInstanceOf(THREE.DataTexture)
    expect(texture.image.width).toBe(TILE_ART_SIZE)
    expect(texture.image.height).toBe(TILE_ART_SIZE)
    expect(pixels(texture).length).toBe(TILE_ART_SIZE * TILE_ART_SIZE * 4)
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.version).toBeGreaterThan(0)

    everyTexel(texture, (t) => expect(t.a).toBe(255))
  })

  test('reads as warm brick, not gray', () => {
    const texture = createBrickTexture()

    let r = 0
    let g = 0
    let b = 0
    everyTexel(texture, (t) => {
      r += t.r
      g += t.g
      b += t.b
    })

    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)

    const colored = new Set<string>()
    everyTexel(texture, (t) => colored.add(`${t.r === t.g && t.g === t.b}`))
    expect(colored.has('false')).toBe(true)
  })

  test('has a dark mortar course between the brick courses', () => {
    const texture = createBrickTexture()
    const average = meanLuma(texture)

    // One mortar course at the base of each of the two courses.
    expect(meanLumaOfRows(texture, [0])).toBeLessThan(average - 15)
    expect(meanLumaOfRows(texture, [8])).toBeLessThan(average - 15)
  })

  test('lays the bricks in a running bond, not a stacked grid', () => {
    const texture = createBrickTexture()

    const lower = jointColumns(texture, 4)
    const upper = jointColumns(texture, 12)

    expect(lower.length).toBeGreaterThan(0)
    expect(upper.length).toBeGreaterThan(0)
    // Offset courses: no vertical joint runs straight through both.
    expect(lower.filter((x) => upper.includes(x))).toEqual([])
  })
})

describe('tileArtForTheme', () => {
  test('routes grass to the ground detail map and castle to brick', () => {
    expect(Array.from(pixels(tileArtForTheme(GRASS_THEME).texture))).toEqual(
      Array.from(pixels(createGroundDetailTexture())),
    )
    expect(Array.from(pixels(tileArtForTheme(CASTLE_THEME).texture))).toEqual(
      Array.from(pixels(createBrickTexture())),
    )

    expect(tileArtForTheme(GRASS_THEME).color).toBe(GRASS_TOP_COLOR)
    expect(tileArtForTheme(CASTLE_THEME).color).toBe(CASTLE_BRICK_COLOR)
  })

  test('CASTLE_BRICK_COLOR is a warm brick tone distinct from the ground palette', () => {
    const r = (CASTLE_BRICK_COLOR >> 16) & 0xff
    const g = (CASTLE_BRICK_COLOR >> 8) & 0xff
    const b = CASTLE_BRICK_COLOR & 0xff

    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(CASTLE_BRICK_COLOR).not.toBe(GRASS_TOP_COLOR)
  })

  test('falls back to the ground art for an unknown theme', () => {
    expect(tileArtForTheme('no-such-theme').texture).toBe(tileArtForTheme(GRASS_THEME).texture)
  })

  test('memoizes, so a theme costs one texture upload', () => {
    expect(tileArtForTheme(CASTLE_THEME).texture).toBe(tileArtForTheme(CASTLE_THEME).texture)
    expect(tileArtForTheme(GRASS_THEME).texture).not.toBe(tileArtForTheme(CASTLE_THEME).texture)
  })
})

describe('applyTileArt', () => {
  function paletteMesh(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      3,
    )
    const color = new THREE.Color()
    mesh.setColorAt(0, color.setHex(GRASS_TOP_COLOR))
    mesh.setColorAt(1, color.setHex(0x8b5a2b))
    mesh.setColorAt(2, color.setHex(GRASS_TOP_COLOR))
    return mesh
  }

  test('maps the theme art onto the material and returns the same mesh', () => {
    const mesh = paletteMesh()
    const material = mesh.material as THREE.MeshLambertMaterial
    const version = material.version

    const returned = applyTileArt(mesh, GRASS_THEME)

    expect(returned).toBe(mesh)
    expect(material.map).toBe(tileArtForTheme(GRASS_THEME).texture)
    // Material.needsUpdate is set-only; the version bump is the observable effect.
    expect(material.version).toBeGreaterThan(version)
  })

  test('leaves the per-instance palette and the base color untouched', () => {
    const mesh = paletteMesh()
    const before = Array.from(mesh.instanceColor!.array)

    applyTileArt(mesh, GRASS_THEME)

    const material = mesh.material as THREE.MeshLambertMaterial
    expect(material.color.getHex()).toBe(0xffffff)
    expect(Array.from(mesh.instanceColor!.array)).toEqual(before)
  })

  test('defaults to the grass theme', () => {
    const mesh = paletteMesh()

    applyTileArt(mesh)

    expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
      tileArtForTheme(GRASS_THEME).texture,
    )
  })

  test('applies the brick art for the castle theme', () => {
    const mesh = paletteMesh()

    applyTileArt(mesh, CASTLE_THEME)

    expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
      tileArtForTheme(CASTLE_THEME).texture,
    )
  })
})

describe('createTileLayer tile art', () => {
  test('maps the ground detail art on by default, keeping the Lambert blockout material', () => {
    const layer = createTileLayer({ count: 4, z: 0, color: 0x4488ff })

    const material = layer.material as THREE.MeshLambertMaterial
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(material.map).toBe(tileArtForTheme(GRASS_THEME).texture)
    expect(material.color.getHex()).toBe(0x4488ff)

    expect(layer.count).toBe(4)
    expect(layer.position.z).toBe(0)
    expect(layer.geometry).toBeInstanceOf(THREE.PlaneGeometry)
  })

  test('maps the brick art on for a castle layer', () => {
    const layer = createTileLayer({ count: 2, z: 0, theme: CASTLE_THEME })

    expect((layer.material as THREE.MeshLambertMaterial).map).toBe(
      tileArtForTheme(CASTLE_THEME).texture,
    )
  })

  test('the tile quad carries 0..1 UVs, so one texture covers exactly one tile', () => {
    const layer = createTileLayer({ count: 1, z: 0 })

    const uv = layer.geometry.getAttribute('uv')
    expect(uv).toBeDefined()

    const values = Array.from(uv.array)
    expect(Math.min(...values)).toBe(0)
    expect(Math.max(...values)).toBe(1)
  })
})

describe('brick tiling', () => {
  // The map is one tile; a castle wall butts copies of it edge to edge. The upper course is
  // offset by half a brick, so one brick is split across the tile seam — its left half sits at
  // x=15 and its right half at x=0 of the neighbouring copy. Both halves have to be shaded as
  // ONE brick, or the wall shows an 8-wide brick that changes color mid-way with no joint.
  test('the brick split across the horizontal seam is shaded as a single brick', () => {
    const texture = createBrickTexture()

    for (const y of [9, 10, 11, 12, 13, 14]) {
      const rightHalf = texel(texture, 0, y)
      const leftHalf = texel(texture, TILE_ART_SIZE - 1, y)

      expect(`y=${y}: ${leftHalf.r},${leftHalf.g},${leftHalf.b}`).toBe(
        `y=${y}: ${rightHalf.r},${rightHalf.g},${rightHalf.b}`,
      )
    }
  })
})
