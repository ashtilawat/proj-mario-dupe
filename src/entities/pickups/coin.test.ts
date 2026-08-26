import { describe, expect, test } from 'vitest'
import { COIN_COLOR, COIN_HEIGHT, COIN_WIDTH, createCoin } from './coin.ts'
import { TILE_SIZE } from '../../physics/index.ts'

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

describe('coin mesh', () => {
  test('is a disc exactly one tile across, in world units', () => {
    const coin = createCoin({ x: 0, y: 0 })
    // Radius, not diameter: half a tile each way spans TILE_SIZE world units.
    expect(coin.mesh.geometry.parameters.radius).toBeCloseTo(TILE_SIZE / 2, 5)
  })

  test('is painted COIN_COLOR', () => {
    expect(createCoin({ x: 0, y: 0 }).mesh.material.color.getHex()).toBe(COIN_COLOR)
  })

  test('COIN_COLOR reads as yellow: red and green high, blue low', () => {
    const r = (COIN_COLOR >> 16) & 0xff
    const g = (COIN_COLOR >> 8) & 0xff
    const b = COIN_COLOR & 0xff
    expect(r).toBeGreaterThan(0xc0)
    expect(g).toBeGreaterThan(0xc0)
    expect(b).toBeLessThan(0x40)
  })

  test('sits centred on the hitbox, on the Z = 0 gameplay plane', () => {
    const coin = createCoin({ x: 5, y: 3 })
    expect(coin.mesh.position.x).toBeCloseTo(5.5 * TILE_SIZE, 5)
    expect(coin.mesh.position.y).toBeCloseTo(3.5 * TILE_SIZE, 5)
    expect(coin.mesh.position.z).toBe(0)
  })

  test('starts visible', () => {
    expect(createCoin({ x: 0, y: 0 }).mesh.visible).toBe(true)
  })
})
