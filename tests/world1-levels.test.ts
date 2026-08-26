// T-023 — structural cover for the World 1 levels added after 1-1. This file deliberately
// imports nothing from src/main.ts: that module pulls in THREE and touches the DOM, and the
// only thing these tests need from it is the row-flip convention, reproduced in solidAt below.

import { describe, expect, test } from 'vitest'
import { decodeTiles, loadLevel } from '../src/levels/index.ts'
import type { Level, LevelEntity } from '../src/levels/index.ts'

/** The six ids T-023 adds. 1-1 already shipped and is covered by tests/level.test.ts. */
const NEW_LEVELS: string[] = ['1-2', '1-3', '1-4', '1-5', '1-6', '1-castle']

/**
 * Is tile (tx, ty) solid, in y-up tile space? The RLE stores rows top-down, so row 0 of the
 * decoded buffer is the TOP row — the same flip createTileGridFromLevel applies in main.ts.
 * Out of bounds reads as empty, matching that grid.
 */
function solidAt(decoded: readonly number[], w: number, h: number, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= w || ty < 0 || ty >= h) return false
  return (decoded[(h - 1 - ty) * w + tx] ?? 0) > 0
}

/** Decoded tiles plus the dimensions they were decoded with. */
function grid(level: Level): { w: number; h: number; decoded: number[] } {
  const [w, h] = level.size
  return { w, h, decoded: decodeTiles(level.tiles, w, h) }
}

function entitiesOfType(level: Level, type: string): LevelEntity[] {
  return level.entities.filter((e) => e.type === type)
}

describe.each(NEW_LEVELS)('level %s', (id) => {
  test('loads under its own id', () => {
    expect(loadLevel(id).id).toBe(id)
  })

  test('has a sane size, theme and empty regions list', () => {
    const level = loadLevel(id)
    const [w, h] = level.size
    expect(Number.isInteger(w) && w > 0).toBe(true)
    expect(h).toBe(12)
    expect(typeof level.theme).toBe('string')
    expect(level.theme.length).toBeGreaterThan(0)
    expect(level.regions).toEqual([])
  })

  test('RLE decodes to exactly width * height tiles, all gid 0 or 1', () => {
    const { w, h, decoded } = grid(loadLevel(id))
    expect(decoded).toHaveLength(w * h)
    expect(decoded.every((gid) => gid === 0 || gid === 1)).toBe(true)
  })

  test('has a walker with a valid dir, a coin and a flag', () => {
    const level = loadLevel(id)
    const walkers = entitiesOfType(level, 'walker')
    expect(walkers.length).toBeGreaterThanOrEqual(1)
    for (const walker of walkers) expect([1, -1]).toContain(walker.props?.dir)
    expect(entitiesOfType(level, 'coin').length).toBeGreaterThanOrEqual(1)
    expect(entitiesOfType(level, 'flag').length).toBeGreaterThanOrEqual(1)
  })

  test('spawn, checkpoint and every entity stand on solid ground', () => {
    const level = loadLevel(id)
    const { w, h, decoded } = grid(level)
    const points: [string, readonly [number, number]][] = [
      ['spawn', level.spawn],
      ['checkpoint', level.checkpoint],
      ...level.entities.map((e): [string, readonly [number, number]] => [e.type, e.at]),
    ]

    for (const [label, [x, y]] of points) {
      const where = `${label} at (${x}, ${y})`
      expect(x >= 0 && x < w, `${where}: x out of bounds`).toBe(true)
      expect(y >= 1 && y < h, `${where}: y out of bounds`).toBe(true)
      expect(solidAt(decoded, w, h, x, y), `${where}: occupies a solid tile`).toBe(false)
      expect(solidAt(decoded, w, h, x, y - 1), `${where}: no floor beneath it`).toBe(true)
    }
  })
})

describe('level 1-castle boss arena', () => {
  test('has a boss whose 3x3 footprint is in bounds and unobstructed', () => {
    const level = loadLevel('1-castle')
    const { w, h, decoded } = grid(level)
    const boss = level.entities.find((e) => e.type === 'boss')
    expect(boss).toBeDefined()
    expect([1, -1]).toContain(boss?.props?.dir)

    const [bx, by] = boss!.at
    expect(bx + 3).toBeLessThanOrEqual(w)
    expect(by + 3).toBeLessThanOrEqual(h)
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const [tx, ty] = [bx + dx, by + dy]
        expect(solidAt(decoded, w, h, tx, ty), `boss footprint tile (${tx}, ${ty}) is solid`)
          .toBe(false)
      }
    }
  })

  test('the flag sits outside the boss footprint', () => {
    const level = loadLevel('1-castle')
    const [bx, by] = level.entities.find((e) => e.type === 'boss')!.at
    const [fx, fy] = level.entities.find((e) => e.type === 'flag')!.at
    expect(fx >= bx && fx < bx + 3 && fy >= by && fy < by + 3).toBe(false)
  })
})

describe('registry regressions', () => {
  test('1-1 still loads', () => {
    expect(loadLevel('1-1').id).toBe('1-1')
  })

  test('unknown ids still throw', () => {
    expect(() => loadLevel('9-9')).toThrow(/Unknown level/)
  })
})
