import { describe, expect, test } from 'vitest'
import { WORLD_1_LEVEL_IDS, flagLines, tagline, title } from '../src/story/index.ts'

describe('title and tagline', () => {
  test('the game has its name', () => {
    expect(title).toBe('Pip and the Paper Hills')
  })

  test('the tagline is the approved line', () => {
    expect(tagline).toBe('Hop far. Land soft.')
  })

  test('both are trimmed, non-empty, and short enough for an overlay', () => {
    for (const [name, value] of [
      ['title', title],
      ['tagline', tagline],
    ] as const) {
      expect(value, name).toBe(value.trim())
      expect(value.length, name).toBeGreaterThan(0)
    }
    expect(title.length).toBeLessThanOrEqual(40)
    expect(tagline.length).toBeLessThanOrEqual(60)
  })
})

describe('flagLines shape', () => {
  test('is exactly the seven World 1 ids, in play order', () => {
    expect(Object.keys(flagLines)).toEqual([
      '1-1',
      '1-2',
      '1-3',
      '1-4',
      '1-5',
      '1-6',
      '1-castle',
    ])
  })

  test('WORLD_1_LEVEL_IDS is the same list, so the two cannot drift apart', () => {
    expect([...WORLD_1_LEVEL_IDS]).toEqual(Object.keys(flagLines))
    expect(WORLD_1_LEVEL_IDS).toHaveLength(7)
  })
})

describe('flag line copy', () => {
  test('each level gets its approved line', () => {
    expect(flagLines).toEqual({
      '1-1': 'First hill down! The sky waves you on.',
      '1-2': 'You out-hopped the wobblers. Nice feet!',
      '1-3': 'Out of the dark, and the lanterns stayed lit.',
      '1-4': 'Over the creek, and not one wet sock!',
      '1-5': 'Up where the clouds nap. Keep climbing!',
      '1-6': 'The castle gate is just past these trees.',
      '1-castle': 'The lantern is home. World 2 is waking up.',
    })
  })

  test('every line is short, trimmed, and closes cleanly', () => {
    for (const id of WORLD_1_LEVEL_IDS) {
      const line = flagLines[id]
      expect(line, id).toBe(line.trim())
      expect(line.length, id).toBeGreaterThan(0)
      expect(line.length, id).toBeLessThanOrEqual(60)
      expect(line, id).toMatch(/[.!?]$/)
    }
  })

  test('no two levels reuse the same line', () => {
    expect(new Set(Object.values(flagLines)).size).toBe(7)
  })
})
