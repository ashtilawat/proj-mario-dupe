import { describe, expect, test } from 'vitest'
import { tagline, title } from '../src/story/index.ts'

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
