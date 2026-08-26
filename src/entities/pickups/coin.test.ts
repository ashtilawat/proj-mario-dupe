import { describe, expect, test } from 'vitest'
import { COIN_HEIGHT, COIN_WIDTH, createCoin } from './coin.ts'

describe('createCoin', () => {
  test('places the hitbox at the spawn tile, one tile square', () => {
    const coin = createCoin({ x: 5, y: 3, id: 7 })
    expect(coin.aabb).toEqual({ x: 5, y: 3, w: COIN_WIDTH, h: COIN_HEIGHT })
  })

  test('is one tile square, so it lines up with the tile grid', () => {
    expect(COIN_WIDTH).toBe(1)
    expect(COIN_HEIGHT).toBe(1)
  })

  test('starts uncollected', () => {
    expect(createCoin({ x: 0, y: 0 }).collected).toBe(false)
  })

  test('takes the spawn id, defaulting to 0 like the walker', () => {
    expect(createCoin({ x: 1, y: 2, id: 42 }).id).toBe(42)
    expect(createCoin({ x: 1, y: 2 }).id).toBe(0)
  })
})
