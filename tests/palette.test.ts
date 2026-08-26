import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  DIRT_COLOR,
  GRASS_TOP_COLOR,
  SKY_COLOR,
  createPlayerCapsule,
  tileColorAt,
} from '../src/render'
import { BACKGROUND_COLOR, createScene, createTileGridFromLevel, createTileMesh } from '../src/main'
import type { TileGrid, TileKind } from '../src/physics'

function channels(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

function isGray(hex: number): boolean {
  const { r, g, b } = channels(hex)
  return r === g && g === b
}

/**
 * A hand-built grid so classification is tested on stacked tiles the real 1-1 lacks.
 * A full TileGrid, not just getTile, so createTileMesh can be driven by it too.
 */
function stubGrid(solids: Array<[number, number]>, width = 4, height = 4): TileGrid {
  const keys = new Set(solids.map(([tx, ty]) => `${tx},${ty}`))
  return {
    width,
    height,
    tileSize: 1,
    getTile(tx: number, ty: number): TileKind {
      return keys.has(`${tx},${ty}`) ? 'solid' : 'empty'
    },
  }
}

describe('palette', () => {
  test('SKY_COLOR reads as sky: blue-dominant and bright, not the old near-black', () => {
    const { r, g, b } = channels(SKY_COLOR)

    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
    expect(b).toBeGreaterThan(0x80)
    expect(isGray(SKY_COLOR)).toBe(false)
    expect(SKY_COLOR).not.toBe(0x101014)
  })

  test('GRASS_TOP_COLOR is green-dominant', () => {
    const { r, g, b } = channels(GRASS_TOP_COLOR)

    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
    expect(isGray(GRASS_TOP_COLOR)).toBe(false)
  })

  test('DIRT_COLOR is a warm brown, distinct from grass', () => {
    const { r, g, b } = channels(DIRT_COLOR)

    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(isGray(DIRT_COLOR)).toBe(false)
    expect(DIRT_COLOR).not.toBe(GRASS_TOP_COLOR)
  })

  test('the old blockout gray is gone from the ground palette', () => {
    expect(GRASS_TOP_COLOR).not.toBe(0x8b8b93)
    expect(DIRT_COLOR).not.toBe(0x8b8b93)
  })
})

describe('tileColorAt', () => {
  test('a solid tile with an empty cell above is grass', () => {
    expect(tileColorAt(stubGrid([[3, 0]]), 3, 0)).toBe(GRASS_TOP_COLOR)
  })

  test('a solid tile buried under another solid tile is dirt', () => {
    const grid = stubGrid([
      [3, 0],
      [3, 1],
    ])

    expect(tileColorAt(grid, 3, 0)).toBe(DIRT_COLOR)
    expect(tileColorAt(grid, 3, 1)).toBe(GRASS_TOP_COLOR)
  })

  test('a solid tile on the top row is grass — out of bounds above reads as empty', () => {
    const grid = stubGrid([[1, 3]], 4, 4)

    expect(grid.getTile(1, 3)).toBe('solid')
    expect(grid.getTile(1, 4)).toBe('empty')
    expect(tileColorAt(grid, 1, 3)).toBe(GRASS_TOP_COLOR)
  })

  test('the real level grid also reports out of bounds as empty', () => {
    const grid = createTileGridFromLevel('1-1')

    expect(grid.getTile(0, grid.height)).toBe('empty')
  })
})

describe('createScene background', () => {
  test('clears to the sky, not a gray void, and stays child-free', () => {
    const scene = createScene()

    expect(BACKGROUND_COLOR).toBe(SKY_COLOR)
    expect(scene.background).toBeInstanceOf(THREE.Color)
    expect((scene.background as THREE.Color).getHex()).toBe(SKY_COLOR)
    expect(scene.children).toHaveLength(0)
  })
})

describe('createTileMesh instance colors', () => {
  test('tints every instance from the palette through a white Lambert material', () => {
    const grid = createTileGridFromLevel('1-1')
    const mesh = createTileMesh(grid)

    const material = mesh.material as THREE.MeshLambertMaterial
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(material.color.getHex()).toBe(0xffffff)

    expect(mesh.instanceColor).not.toBeNull()
    expect(mesh.instanceColor!.count).toBe(mesh.count)

    // Walk the grid in createTileMesh's own tx/ty order so instance i lines up with its cell.
    const expected: number[] = []
    for (let ty = 0; ty < grid.height; ty += 1) {
      for (let tx = 0; tx < grid.width; tx += 1) {
        if (grid.getTile(tx, ty) === 'solid') expected.push(tileColorAt(grid, tx, ty))
      }
    }
    expect(expected).toHaveLength(mesh.count)

    const actual = new THREE.Color()
    const want = new THREE.Color()
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getColorAt(i, actual)
      want.setHex(expected[i]!)
      expect(actual.r).toBeCloseTo(want.r, 3)
      expect(actual.g).toBeCloseTo(want.g, 3)
      expect(actual.b).toBeCloseTo(want.b, 3)
    }
  })

  test('1-1 is one tile thick, so every live tile is grass', () => {
    const grid = createTileGridFromLevel('1-1')
    const mesh = createTileMesh(grid)

    const grass = new THREE.Color(GRASS_TOP_COLOR)
    const actual = new THREE.Color()
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getColorAt(i, actual)
      expect(actual.getHex()).toBe(grass.getHex())
    }
  })

  test('a stacked column comes out dirt under grass, in instance order', () => {
    // Deliberately asymmetric: a 3-tall column at tx=1 plus a lone tile at tx=3. Swapping
    // tx/ty in the tileColorAt call, or dropping the call entirely, changes this sequence.
    const grid = stubGrid(
      [
        [1, 0],
        [1, 1],
        [1, 2],
        [3, 0],
      ],
      4,
      4,
    )
    const mesh = createTileMesh(grid)

    // createTileMesh walks ty outer, tx inner:
    //   ty=0 -> (1,0) buried, (3,0) exposed;  ty=1 -> (1,1) buried;  ty=2 -> (1,2) exposed.
    const expected = [DIRT_COLOR, GRASS_TOP_COLOR, DIRT_COLOR, GRASS_TOP_COLOR]
    expect(mesh.count).toBe(expected.length)

    const actual = new THREE.Color()
    const got: number[] = []
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getColorAt(i, actual)
      got.push(actual.getHex())
    }
    expect(got).toEqual(expected)
  })

  test('a grid with no solid tiles produces an empty batch and no instance colors', () => {
    const mesh = createTileMesh(stubGrid([], 4, 4))

    expect(mesh.count).toBe(0)
    expect(mesh.instanceColor).toBeNull()
  })

  test('stays a single InstancedMesh', () => {
    const mesh = createTileMesh(createTileGridFromLevel('1-1'))

    expect(mesh).toBeInstanceOf(THREE.InstancedMesh)
    expect(mesh.count).toBeGreaterThan(0)
  })
})

describe('player color', () => {
  test('the capsule keeps its yellow — T-021 recolors ground and sky only', () => {
    const material = createPlayerCapsule().material as THREE.MeshLambertMaterial

    expect(material.color.getHex()).toBe(0xe8c547)
  })
})
