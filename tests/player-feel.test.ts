import { describe, expect, test } from 'vitest'
import {
  DASH_MAX,
  FIXED_DT,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_CUTOFF_FACTOR,
  JUMP_VELOCITY,
  TILE_SIZE,
  WALK_MAX,
} from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import { createPlayer } from '../src/entities/player/index.ts'
import type { Player, PlayerInput } from '../src/entities/player/index.ts'

function makeGrid(rows: string[]): TileGrid {
  const height = rows.length
  const width = rows[0]?.length ?? 0

  return {
    width,
    height,
    tileSize: TILE_SIZE,
    getTile(tx: number, ty: number): TileKind {
      const row = rows[height - 1 - ty]
      return row?.[tx] === '#' ? 'solid' : 'empty'
    },
  }
}

function flatGround(width: number, height: number): TileGrid {
  const rows = Array.from({ length: height }, () => '.'.repeat(width))
  rows[height - 1] = '#'.repeat(width)
  return makeGrid(rows)
}

function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { jump: false, dash: false, moveX: 0, ...partial }
}

function stepFor(player: Player, frames: number, held: PlayerInput = input()): void {
  for (let i = 0; i < frames; i += 1) player.step(FIXED_DT, held)
}

function settle(player: Player): Player {
  stepFor(player, 2)
  return player
}

function onGround(x = 2): Player {
  return settle(createPlayer({ x, y: 1, grid: flatGround(64, 8) }))
}

function peakHeight(holdFrames: number): number {
  const player = onGround()
  const restingY = player.body.aabb.y
  let peak = 0
  let hasLeftGround = false

  for (let i = 0; i < 600; i += 1) {
    player.step(FIXED_DT, input({ jump: i < holdFrames }))
    const height = player.body.aabb.y - restingY
    if (height > peak) peak = height
    if (!player.grounded) hasLeftGround = true
    if (hasLeftGround && player.grounded) return peak
  }

  throw new Error('player never landed within the frame cap')
}

function fullHoldPeak(): number {
  return peakHeight(Number.POSITIVE_INFINITY)
}

describe('dash ramp', () => {
  function speedAfter(frames: number, dash: boolean): number {
    const player = onGround()
    stepFor(player, frames, input({ moveX: 1, right: true, dash }))
    return player.body.velocity.x
  }

  test('a short hold is 1.6x walk, not ~1.33x', () => {
    expect(speedAfter(32, true) / speedAfter(32, false)).toBeCloseTo(1.6, 10)
  })

  test('dash reaches DASH_MAX in the same frames walk reaches WALK_MAX', () => {
    const framesToWalkMax = Math.ceil(WALK_MAX / (GROUND_ACCEL * FIXED_DT))
    expect(speedAfter(framesToWalkMax, false)).toBeCloseTo(WALK_MAX, 10)
    expect(speedAfter(framesToWalkMax, true)).toBeCloseTo(DASH_MAX, 10)
  })

  test('dash is 1.6x walk at every frame of the ramp', () => {
    for (let f = 1; f <= 40; f += 1) {
      expect(speedAfter(f, true)).toBeCloseTo(1.6 * speedAfter(f, false), 10)
    }
  })
})

describe('buffered tap jump', () => {
  const FALL_GRID = flatGround(16, 12)

  function falling(): Player {
    return createPlayer({ x: 4, y: 8, grid: FALL_GRID })
  }

  function framesUntilLanding(): number {
    const probe = falling()
    for (let i = 1; i <= 600; i += 1) {
      probe.step(FIXED_DT, input())
      if (probe.grounded) return i
    }
    throw new Error('probe never landed')
  }

  function launchBuffered(framesEarly: number, holdAfter: boolean): Player {
    const landing = framesUntilLanding()
    const player = falling()
    stepFor(player, landing - framesEarly)
    player.step(FIXED_DT, input({ jump: true }))
    const held = holdAfter ? input({ jump: true }) : input()
    while (!player.grounded) player.step(FIXED_DT, held)
    player.step(FIXED_DT, held)
    return player
  }

  function bufferedJumpPeak(framesEarly: number, holdAfter: boolean): number {
    const player = launchBuffered(framesEarly, holdAfter)
    const restingY = 1
    let peak = Math.max(0, player.body.aabb.y - restingY)
    let hasLeftGround = !player.grounded
    const held = holdAfter ? input({ jump: true }) : input()

    for (let i = 0; i < 600; i += 1) {
      player.step(FIXED_DT, held)
      const height = player.body.aabb.y - restingY
      if (height > peak) peak = height
      if (!player.grounded) hasLeftGround = true
      if (hasLeftGround && player.grounded) return peak
    }
    throw new Error('buffered jump never landed')
  }

  test('a buffered tap released before touchdown cuts instead of full height', () => {
    expect(bufferedJumpPeak(8, false)).toBeLessThan(0.3 * fullHoldPeak())
  })

  test('a buffered press still held at touchdown keeps the full arc', () => {
    expect(bufferedJumpPeak(8, true)).toBeCloseTo(fullHoldPeak(), 5)
  })

  test('buffered tap launches at JUMP_VELOCITY then cuts the next rising frame', () => {
    const player = launchBuffered(8, false)
    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY, 10)

    player.step(FIXED_DT, input())

    expect(player.body.velocity.y).toBeCloseTo(
      (JUMP_VELOCITY - GRAVITY * FIXED_DT) * JUMP_CUTOFF_FACTOR,
      10,
    )
  })
})
