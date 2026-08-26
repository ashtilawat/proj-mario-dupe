import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  CASTLE_BRICK_COLOR,
  CASTLE_INSTANCE_TINT,
  CASTLE_THEME,
  DIRT_COLOR,
  GRASS_THEME,
  GRASS_TOP_COLOR,
  GROUND_LUMA_FLOOR,
  SKY_COLOR,
  TILE_ART_SIZE,
  UNDERGROUND_LUMA_FLOOR,
  UNDERGROUND_ROCK_COLOR,
  UNDERGROUND_SKY_COLOR,
  UNDERGROUND_THEME,
  applyTileArt,
  createBrickTexture,
  createGroundDetailTexture,
  createTileLayer,
  createUndergroundDetailTexture,
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

function meanLumaOfColumns(texture: THREE.DataTexture, columns: number[]): number {
  let total = 0
  for (const x of columns) {
    for (let y = 0; y < texture.image.height; y += 1) total += luma(texel(texture, x, y))
  }
  return total / (columns.length * texture.image.height)
}

/** Mean luma of everything the 1-texel edge groove does not touch. */
function meanOfInterior(texture: THREE.DataTexture): number {
  let total = 0
  let count = 0
  for (let y = 1; y < texture.image.height - 1; y += 1) {
    for (let x = 1; x < texture.image.width - 1; x += 1) {
      total += luma(texel(texture, x, y))
      count += 1
    }
  }
  return total / count
}

function meanLuma(texture: THREE.DataTexture): number {
  const all = Array.from({ length: texture.image.height }, (_, y) => y)
  return meanLumaOfRows(texture, all)
}

/** A palette hex as a texel, so the luma helper can weigh a flat tint like it weighs art. */
function hexTexel(hex: number): Texel {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff, a: 255 }
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

describe('createUndergroundDetailTexture', () => {
  test('is a 16x16 RGBA DataTexture flagged for upload', () => {
    const texture = createUndergroundDetailTexture()

    expect(texture).toBeInstanceOf(THREE.DataTexture)
    expect(texture.image.width).toBe(TILE_ART_SIZE)
    expect(texture.image.height).toBe(TILE_ART_SIZE)
    expect(pixels(texture)).toBeInstanceOf(Uint8Array)
    expect(pixels(texture).length).toBe(TILE_ART_SIZE * TILE_ART_SIZE * 4)
    expect(texture.version).toBeGreaterThan(0)
    expect(texture.flipY).toBe(false)

    everyTexel(texture, (t) => expect(t.a).toBe(255))
  })

  test('is grayscale, so the rock tint multiplies through it', () => {
    const texture = createUndergroundDetailTexture()

    everyTexel(texture, (t, x, y) => {
      expect(`${x},${y}:${t.r},${t.g},${t.b}`).toBe(`${x},${y}:${t.r},${t.r},${t.r}`)
    })
  })

  test('sits below the grass floor without crushing to black', () => {
    const texture = createUndergroundDetailTexture()

    everyTexel(texture, (t) => {
      expect(t.r).toBeGreaterThanOrEqual(UNDERGROUND_LUMA_FLOOR)
      expect(t.r).toBeLessThanOrEqual(255)
    })
    expect(UNDERGROUND_LUMA_FLOOR).toBeLessThan(GROUND_LUMA_FLOOR)
  })

  test('is not a flat fill', () => {
    const shades = new Set<number>()
    everyTexel(createUndergroundDetailTexture(), (t) => shades.add(t.r))

    expect(shades.size).toBeGreaterThan(4)
    expect(Math.min(...shades)).toBeLessThan(Math.max(...shades))
  })

  test('has no lit crown — a cave tile is not sun-lit from above', () => {
    const texture = createUndergroundDetailTexture()

    const top = meanLumaOfRows(texture, [12, 13, 14, 15])
    const bottom = meanLumaOfRows(texture, [0, 1, 2, 3])

    // The grass map asserts a 20+ gap here. Underground is vertically symmetric instead.
    expect(Math.abs(top - bottom)).toBeLessThan(8)
  })

  test('is symmetric top to bottom, texel for texel', () => {
    const texture = createUndergroundDetailTexture()

    for (let y = 0; y < TILE_ART_SIZE; y += 1) {
      for (let x = 0; x < TILE_ART_SIZE; x += 1) {
        const low = texel(texture, x, y)
        const high = texel(texture, x, TILE_ART_SIZE - 1 - y)
        expect(`${x},${y}:${low.r}`).toBe(`${x},${y}:${high.r}`)
      }
    }
  })

  test('cuts a dark groove around all four edges', () => {
    const texture = createUndergroundDetailTexture()
    const interior = meanOfInterior(texture)

    expect(meanLumaOfRows(texture, [0])).toBeLessThan(interior - 20)
    expect(meanLumaOfRows(texture, [TILE_ART_SIZE - 1])).toBeLessThan(interior - 20)
    expect(meanLumaOfColumns(texture, [0])).toBeLessThan(interior - 20)
    expect(meanLumaOfColumns(texture, [TILE_ART_SIZE - 1])).toBeLessThan(interior - 20)
  })

  test('is deterministic and hands back a fresh texture each call', () => {
    expect(Array.from(pixels(createUndergroundDetailTexture()))).toEqual(
      Array.from(pixels(createUndergroundDetailTexture())),
    )
    expect(createUndergroundDetailTexture()).not.toBe(createUndergroundDetailTexture())
  })

  test('is its own art, not a copy of the grass ground map', () => {
    expect(Array.from(pixels(createUndergroundDetailTexture()))).not.toEqual(
      Array.from(pixels(createGroundDetailTexture())),
    )
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

  test('routes underground to its own art rather than the grass fallback', () => {
    expect(Array.from(pixels(tileArtForTheme(UNDERGROUND_THEME).texture))).toEqual(
      Array.from(pixels(createUndergroundDetailTexture())),
    )
    expect(tileArtForTheme(UNDERGROUND_THEME).texture).not.toBe(
      tileArtForTheme(GRASS_THEME).texture,
    )

    expect(tileArtForTheme(UNDERGROUND_THEME).color).toBe(UNDERGROUND_ROCK_COLOR)
    expect(tileArtForTheme(UNDERGROUND_THEME).color).not.toBe(GRASS_TOP_COLOR)
  })

  test('memoizes the underground art too', () => {
    expect(tileArtForTheme(UNDERGROUND_THEME).texture).toBe(
      tileArtForTheme(UNDERGROUND_THEME).texture,
    )
    expect(tileArtForTheme(UNDERGROUND_THEME).texture).not.toBe(
      tileArtForTheme(CASTLE_THEME).texture,
    )
  })

  test('UNDERGROUND_ROCK_COLOR is a cool slate darker than the whole ground palette', () => {
    const rock = hexTexel(UNDERGROUND_ROCK_COLOR)

    // Blue-dominant: the inverse of the warm brick, which is red-dominant.
    expect(rock.b).toBeGreaterThan(rock.g)
    expect(rock.g).toBeGreaterThan(rock.r)

    expect(luma(rock)).toBeLessThan(luma(hexTexel(GRASS_TOP_COLOR)))
    expect(luma(rock)).toBeLessThan(luma(hexTexel(DIRT_COLOR)))
  })

  test('only grass declines to repaint the per-instance palette', () => {
    // Guard against a vacuous pass: with the tint constants missing, both sides of the
    // comparisons below would read `undefined` and match anyway.
    expect(typeof UNDERGROUND_ROCK_COLOR).toBe('number')
    expect(typeof CASTLE_INSTANCE_TINT).toBe('number')

    expect(tileArtForTheme(GRASS_THEME).instanceTint).toBeUndefined()
    expect(tileArtForTheme(UNDERGROUND_THEME).instanceTint).toBe(UNDERGROUND_ROCK_COLOR)
    expect(tileArtForTheme(CASTLE_THEME).instanceTint).toBe(CASTLE_INSTANCE_TINT)
    // An unknown theme is grass, so it must not repaint either.
    expect(tileArtForTheme('no-such-theme').instanceTint).toBeUndefined()
  })
})

describe('UNDERGROUND_SKY_COLOR', () => {
  test('is a near-black cave void, distinct from the grass sky', () => {
    const sky = hexTexel(UNDERGROUND_SKY_COLOR)

    expect(luma(sky)).toBeLessThan(40)
    expect(sky.b).toBeGreaterThan(sky.r)
    expect(UNDERGROUND_SKY_COLOR).not.toBe(SKY_COLOR)
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

  function instanceColors(mesh: THREE.InstancedMesh): number[] {
    return Array.from(mesh.instanceColor!.array)
  }

  /**
   * The buffer holds the working-space (linear) triples `Color.setHex` decodes an sRGB hex to,
   * not the hex bytes — so the expectation has to go through THREE.Color the same way.
   */
  function expectedTint(hex: number, instances: number): number[] {
    const rgb = new THREE.Color().setHex(hex).toArray()
    return Array.from({ length: instances }, () => rgb).flat()
  }

  test('overwrites the grass palette with rock for the underground theme', () => {
    const mesh = paletteMesh()
    const version = mesh.instanceColor!.version

    applyTileArt(mesh, UNDERGROUND_THEME)

    const expected = expectedTint(UNDERGROUND_ROCK_COLOR, mesh.count)
    expect(instanceColors(mesh)).toHaveLength(expected.length)
    instanceColors(mesh).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5))

    // BufferAttribute.needsUpdate is set-only; the version bump is the observable effect.
    expect(mesh.instanceColor!.version).toBeGreaterThan(version)
    expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
      tileArtForTheme(UNDERGROUND_THEME).texture,
    )
    // The base color is still the caller's; only the per-instance palette is repainted.
    expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0xffffff)
  })

  test('the repainted underground tiles are darker than the grass they replaced', () => {
    const before = paletteMesh()
    const after = paletteMesh()

    applyTileArt(after, UNDERGROUND_THEME)

    const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
    expect(sum(instanceColors(after))).toBeLessThan(sum(instanceColors(before)))
  })

  test('overwrites the grass palette with white for castle, so no green leaks into the brick', () => {
    const mesh = paletteMesh()
    const version = mesh.instanceColor!.version

    applyTileArt(mesh, CASTLE_THEME)

    const expected = expectedTint(CASTLE_INSTANCE_TINT, mesh.count)
    instanceColors(mesh).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5))
    expect(mesh.instanceColor!.version).toBeGreaterThan(version)
  })

  test('repaints the whole instance color buffer, not just the drawn prefix', () => {
    const mesh = paletteMesh()
    // three lets a consumer draw a prefix of the batch by lowering `count`; the buffer keeps
    // its full length. Repainting only the prefix would leave World 1-1 green in the tail,
    // ready to reappear the moment `count` goes back up.
    mesh.count = 1

    applyTileArt(mesh, UNDERGROUND_THEME)

    const expected = expectedTint(UNDERGROUND_ROCK_COLOR, mesh.instanceColor!.count)
    expect(instanceColors(mesh)).toHaveLength(expected.length)
    instanceColors(mesh).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5))
  })

  test('never allocates an instance color buffer that was not already there', () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0x4488ff }),
      2,
    )

    applyTileArt(mesh, UNDERGROUND_THEME)

    // Allocating one here would silently override a blockout layer's own opts.color.
    expect(mesh.instanceColor).toBeNull()
    expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
      tileArtForTheme(UNDERGROUND_THEME).texture,
    )
    expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0x4488ff)
  })

  test('leaves a plain non-instanced mesh alone apart from the map', () => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0xff00ff }),
    )

    expect(() => applyTileArt(mesh, UNDERGROUND_THEME)).not.toThrow()
    expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
      tileArtForTheme(UNDERGROUND_THEME).texture,
    )
    expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0xff00ff)
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
