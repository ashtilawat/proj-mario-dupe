import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertTiledMap, decodeTiles, encodeTiles, loadLevel } from '../src/levels/index.ts'
import type { TiledMap } from '../src/levels/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('RLE tiles', () => {
  test('encodes mixed runs', () => {
    expect(encodeTiles([0, 0, 0, 1, 1, 0])).toBe('3:0,2:1,1:0')
  })
  test('round-trips a mixed buffer', () => {
    const data = [0, 0, 1, 1, 1, 0, 2, 2]
    expect(decodeTiles(encodeTiles(data), 4, 2)).toEqual(data)
  })
  test('empty string decodes to zeros', () => {
    expect(decodeTiles('', 2, 2)).toEqual([0, 0, 0, 0])
  })
  test('encode of empty is empty string', () => {
    expect(encodeTiles([])).toBe('')
  })
})

function miniMap(): TiledMap {
  return {
    width: 4,
    height: 3,
    tilewidth: 16,
    tileheight: 16,
    properties: [
      { name: 'id', type: 'string', value: 't' },
      { name: 'theme', type: 'string', value: 'grass' },
    ],
    layers: [
      { type: 'tilelayer', name: 'tiles', data: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1] },
      {
        type: 'objectgroup',
        name: 'objects',
        objects: [
          { name: 'spawn', type: 'spawn', x: 8, y: 32 },
          { name: 'checkpoint', type: 'checkpoint', x: 24, y: 32 },
          { name: 'walker', type: 'walker', x: 40, y: 32, properties: [{ name: 'dir', type: 'int', value: -1 }] },
          { name: 'goal', type: 'flag', x: 56, y: 32 },
        ],
      },
    ],
  }
}

describe('Tiled convert', () => {
  test('maps spawn, checkpoint, walker dir, flag, size, theme, y-up', () => {
    const level = convertTiledMap(miniMap(), 'fallback')
    expect(level.id).toBe('t')
    expect(level.size).toEqual([4, 3])
    expect(level.theme).toBe('grass')
    expect(level.regions).toEqual([])
    expect(level.spawn).toEqual([0.5, 1])
    expect(level.checkpoint).toEqual([1.5, 1])
    expect(level.entities).toEqual([
      { type: 'walker', at: [2.5, 1], props: { dir: -1 } },
      { type: 'flag', at: [3.5, 1] },
    ])
    expect(decodeTiles(level.tiles, 4, 3)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1])
  })
})

describe('World 1-1', () => {
  test('loadLevel returns the PRD shape', () => {
    const level = loadLevel('1-1')
    expect(level.id).toBe('1-1')
    expect(level.size[0]).toBeGreaterThanOrEqual(48)
    expect(level.size[1]).toBe(12)
    expect(typeof level.tiles).toBe('string')
    expect(level.tiles.length).toBeGreaterThan(0)
    expect(level.spawn).toHaveLength(2)
    expect(level.checkpoint).toHaveLength(2)
    expect(level.theme).toBe('grass')
    expect(level.regions).toEqual([])
    expect(level.entities.filter((e) => e.type === 'walker').length).toBeGreaterThanOrEqual(3)
    expect(level.entities.filter((e) => e.type === 'coin').length).toBeGreaterThanOrEqual(4)
    expect(level.entities.some((e) => e.type === 'flag')).toBe(true)
  })
  test('loadLevel matches the compact 1-1 JSON', () => {
    const compact = JSON.parse(readFileSync(resolve(root, 'src/levels/data/1-1.json'), 'utf8'))
    expect(loadLevel('1-1')).toEqual(compact)
  })
  test('unknown id throws', () => {
    expect(() => loadLevel('9-9')).toThrow(/Unknown level/)
  })
})
