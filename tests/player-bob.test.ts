import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, TILE_SIZE, WALK_MAX } from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import {
  BOB_AMPLITUDE,
  BOB_FADE_RATE,
  BOB_MIN_SPEED,
  BOB_STRIDE,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  createPlayer,
  walkBobOffset,
} from '../src/entities/player/player.ts'
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

function onGround(x = 2, mesh?: THREE.Object3D): Player {
  const player = createPlayer({ x, y: 1, grid: flatGround(64, 12), mesh })
  stepFor(player, 2)
  return player
}

/**
 * The bob, measured as the mesh's lift ABOVE the hitbox centre. Reading it this way is the
 * point: a bob that leaked into body.aabb would move the centre with the mesh and measure
 * zero here, so every assertion below is simultaneously an independence assertion.
 */
function bobLift(player: Player): number {
  return player.mesh.position.y - (player.body.aabb.y + PLAYER_HEIGHT / 2)
}

describe('the walk bob curve', () => {
  test('is exactly zero at the bottom of the cycle', () => {
    // Phase 0 is where a walk starts and where it is parked when idle, so an offset here
    // would shift the resting mesh off the hitbox centre.
    expect(walkBobOffset(0, BOB_AMPLITUDE)).toBe(0)
    expect(walkBobOffset(2 * Math.PI, BOB_AMPLITUDE)).toBeCloseTo(0, 10)
  })

  test('peaks at the amplitude halfway through the cycle', () => {
    expect(walkBobOffset(Math.PI, BOB_AMPLITUDE)).toBeCloseTo(BOB_AMPLITUDE, 10)
  })

  test('never goes negative and never overshoots the amplitude', () => {
    // Non-negative is what keeps the shoes out of the floor: the character lifts off its
    // rest pose rather than sinking below it.
    for (let i = 0; i <= 400; i += 1) {
      const offset = walkBobOffset((i / 400) * 6 * Math.PI, BOB_AMPLITUDE)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(BOB_AMPLITUDE)
    }
  })

  test('a zero amplitude is flat at every phase', () => {
    for (const phase of [0, 0.7, Math.PI, 4.2, 2 * Math.PI]) {
      expect(walkBobOffset(phase, 0)).toBe(0)
    }
  })

  test('the tuning constants stay in Mario range', () => {
    // A bob taller than the hat reads as a pogo stick, and one below a pixel reads as nothing.
    expect(BOB_AMPLITUDE).toBeGreaterThan(0.02)
    expect(BOB_AMPLITUDE).toBeLessThan(0.12)
    expect(BOB_AMPLITUDE).toBeLessThan(PLAYER_HEIGHT / 10)
    // At WALK_MAX this is ~3.75 cycles/s — a brisk stride, not a vibration.
    expect(WALK_MAX / BOB_STRIDE).toBeGreaterThan(2)
    expect(WALK_MAX / BOB_STRIDE).toBeLessThan(6)
    // A full amplitude must fade in well under a fifth of a second or a jump pops.
    expect(BOB_AMPLITUDE / BOB_FADE_RATE).toBeLessThan(0.2)
    expect(BOB_MIN_SPEED).toBeGreaterThan(0)
    expect(BOB_MIN_SPEED).toBeLessThan(WALK_MAX / 4)
  })
})

describe('the bob is active only when grounded and walking', () => {
  const WALL = makeGrid([
    '................',
    '......#.........',
    '......#.........',
    '......#.........',
    '################',
  ])

  test('standing still parks the mesh bit-exactly on the hitbox centre', () => {
    const player = onGround()

    // Not toBeCloseTo: moveToward snaps, so a resting mesh must be EXACTLY centred. An
    // asymptotic decay would leave a crumb here and drift the art off the hitbox.
    for (let i = 0; i < 120; i += 1) {
      player.step(FIXED_DT, input())
      expect(bobLift(player)).toBe(0)
    }
  })

  test('walking lifts the mesh and oscillates', () => {
    const player = onGround()
    const lifts: number[] = []

    for (let i = 0; i < 180; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      lifts.push(bobLift(player))
    }

    // It rises...
    expect(Math.max(...lifts)).toBeGreaterThan(BOB_AMPLITUDE / 2)
    // ...and it comes back down, rather than parking at a constant offset.
    expect(Math.min(...lifts)).toBeLessThan(BOB_AMPLITUDE / 10)
    // Never below the rest pose and never above the cap. bobLift subtracts the hitbox
    // centre off an already-rounded sum (mesh.position.y is IEEE 754 float64), so the
    // recovered lift can sit one ULP above the cap; the upper bound slack is exactly that.
    for (const lift of lifts) {
      expect(lift).toBeGreaterThanOrEqual(0)
      expect(lift).toBeLessThanOrEqual(BOB_AMPLITUDE + Number.EPSILON * Math.abs(player.mesh.position.y))
    }
  })

  test('walking left bobs just like walking right', () => {
    const player = onGround()
    let peak = 0

    for (let i = 0; i < 180; i += 1) {
      player.step(FIXED_DT, input({ moveX: -1, left: true }))
      peak = Math.max(peak, bobLift(player))
    }

    expect(peak).toBeGreaterThan(BOB_AMPLITUDE / 2)
  })

  test('a jump taken mid-stride fades the bob out and stays exactly still in the air', () => {
    const player = onGround()
    const walking = input({ moveX: 1, right: true })
    stepFor(player, 60, walking)
    expect(bobLift(player)).toBeGreaterThan(0)

    const held = input({ moveX: 1, right: true, jump: true })
    player.step(FIXED_DT, held)
    expect(player.grounded).toBe(false)

    // A full amplitude sheds in BOB_AMPLITUDE / BOB_FADE_RATE seconds; allow a few frames
    // of slack, then demand a bit-exact zero for the whole rest of the airtime.
    const fadeFrames = Math.ceil(BOB_AMPLITUDE / BOB_FADE_RATE / FIXED_DT) + 3
    stepFor(player, fadeFrames, held)

    let airborneFrames = 0
    while (!player.grounded && airborneFrames < 600) {
      expect(bobLift(player)).toBe(0)
      player.step(FIXED_DT, held)
      airborneFrames += 1
    }
    expect(airborneFrames).toBeGreaterThan(10)
  })

  test('the bob fades out over several frames on takeoff instead of popping', () => {
    const player = onGround()
    stepFor(player, 60, input({ moveX: 1, right: true }))
    expect(bobLift(player)).toBeGreaterThan(0)

    const held = input({ moveX: 1, right: true, jump: true })
    player.step(FIXED_DT, held)
    expect(player.grounded).toBe(false)

    // Count the airborne frames still carrying lift. moveToward sheds BOB_FADE_RATE per
    // second, so a full amplitude needs about 12 frames at 120 Hz. Assigning targetAmp
    // straight to bobAmp would zero it in a single frame and snap the mesh down the whole
    // lift at once — the exact pop the fade exists to prevent.
    let fadingFrames = 0
    while (!player.grounded && bobLift(player) > 0) {
      player.step(FIXED_DT, held)
      fadingFrames += 1
    }

    expect(fadingFrames).toBeGreaterThan(4)
    expect(fadingFrames).toBeLessThanOrEqual(Math.ceil(BOB_AMPLITUDE / BOB_FADE_RATE / FIXED_DT) + 1)
  })

  test('walking off a ledge stops bobbing instead of bouncing through the fall', () => {
    const LEDGE = makeGrid([
      '................',
      '................',
      '####............',
      '................',
      '################',
    ])
    const player = createPlayer({ x: 1, y: 3, grid: LEDGE })
    stepFor(player, 2)
    const walking = input({ moveX: 1, right: true })

    let sawFalling = false
    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, walking)
      if (!player.grounded && player.body.velocity.y < 0) {
        if (!sawFalling) {
          sawFalling = true
          stepFor(player, Math.ceil(BOB_AMPLITUDE / BOB_FADE_RATE / FIXED_DT) + 3, walking)
        }
        if (!player.grounded) expect(bobLift(player)).toBe(0)
      }
    }

    expect(sawFalling).toBe(true)
  })

  test('releasing the stick settles back to a bit-exact zero', () => {
    const player = onGround()
    stepFor(player, 60, input({ moveX: 1, right: true }))
    expect(bobLift(player)).toBeGreaterThan(0)

    // Friction takes ~18 frames to stop the player, then the amplitude fades.
    stepFor(player, 60)

    for (let i = 0; i < 120; i += 1) {
      player.step(FIXED_DT, input())
      expect(bobLift(player)).toBe(0)
    }
  })

  test('pushing into a wall stands still rather than bobbing on the spot', () => {
    const player = createPlayer({ x: 2, y: 1, grid: WALL })
    stepFor(player, 2)
    const pushing = input({ moveX: 1, right: true })

    // Walk into the wall; the sweep zeroes vx on contact.
    stepFor(player, 180, pushing)
    expect(player.grounded).toBe(true)
    expect(Math.abs(player.body.velocity.x)).toBeLessThan(BOB_MIN_SPEED)

    // Intent is still held. Gating on intent instead of speed would bob here forever.
    for (let i = 0; i < 60; i += 1) {
      player.step(FIXED_DT, pushing)
      expect(bobLift(player)).toBe(0)
    }
  })
})

describe('the bob is phased on distance, not on the clock', () => {
  /** Walk until `distance` tiles are covered, sampling the lift every frame. */
  function liftsOverDistance(distance: number, moveX: number): number[] {
    const player = onGround()
    const held = input({ moveX, right: moveX > 0, left: moveX < 0 })
    const startX = player.body.aabb.x
    const lifts: number[] = []

    for (let i = 0; i < 4000; i += 1) {
      player.step(FIXED_DT, held)
      lifts.push(bobLift(player))
      if (Math.abs(player.body.aabb.x - startX) >= distance) return lifts
    }
    throw new Error('player never covered the distance')
  }

  /** Strict local maxima — one per bob cycle. */
  function countPeaks(lifts: number[]): number {
    let peaks = 0
    for (let i = 1; i < lifts.length - 1; i += 1) {
      if (lifts[i]! > lifts[i - 1]! && lifts[i]! >= lifts[i + 1]!) peaks += 1
    }
    return peaks
  }

  test('the same ground covered is the same number of steps, whatever the speed', () => {
    // Three strides' worth of ground. A clock-phased bob would give the half-speed walk
    // twice as many cycles, because it spends twice as long covering the same tiles.
    const distance = 3 * BOB_STRIDE
    const full = countPeaks(liftsOverDistance(distance, 1))
    const half = countPeaks(liftsOverDistance(distance, 0.5))

    expect(full).toBe(3)
    expect(half).toBe(full)
  })

  test('a half-speed walk takes about twice as long to cover the same stride', () => {
    // Guards the premise of the test above: the two runs really are different in time.
    const distance = 3 * BOB_STRIDE
    const fullFrames = liftsOverDistance(distance, 1).length
    const halfFrames = liftsOverDistance(distance, 0.5).length

    expect(halfFrames / fullFrames).toBeGreaterThan(1.6)
  })

  test('a slower walk bobs lower', () => {
    const peakAt = (moveX: number): number => {
      const player = onGround()
      const held = input({ moveX, right: true })
      let peak = 0
      for (let i = 0; i < 300; i += 1) {
        player.step(FIXED_DT, held)
        peak = Math.max(peak, bobLift(player))
      }
      return peak
    }

    const full = peakAt(1)
    const half = peakAt(0.5)

    expect(full).toBeCloseTo(BOB_AMPLITUDE, 3)
    expect(half).toBeLessThan(full * 0.75)
    expect(half).toBeGreaterThan(0)
  })

  test('dashing does not lift the character any higher than a full walk', () => {
    // DASH_MAX is 1.6x WALK_MAX; the amplitude is clamped so dash feel stays out of T-042.
    const player = onGround()
    const held = input({ moveX: 1, right: true, dash: true })
    let peak = 0

    for (let i = 0; i < 300; i += 1) {
      player.step(FIXED_DT, held)
      peak = Math.max(peak, bobLift(player))
      // bobLift subtracts the hitbox centre off an already-rounded sum (mesh.position.y is
      // IEEE 754 float64), so the recovered lift can sit one ULP above the cap; the upper
      // bound slack is exactly that.
      expect(bobLift(player)).toBeLessThanOrEqual(BOB_AMPLITUDE + Number.EPSILON * Math.abs(player.mesh.position.y))
    }

    expect(peak).toBeCloseTo(BOB_AMPLITUDE, 3)
  })
})

describe('the bob is decoration and nothing else', () => {
  test('the walk never lifts the hitbox off the floor', () => {
    // The bob moves the MESH. If it ever leaked into body.aabb the character would climb the
    // screen as it walked — and bobLift, which subtracts that same centre back off, would read
    // exactly zero and never notice. This is the test that watches the hitbox itself.
    const player = onGround()
    const resting = player.body.aabb.y

    for (let i = 0; i < 600; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      expect(player.body.aabb.y).toBeCloseTo(resting, 10)
    }
  })

  test('the walk never nudges the hitbox horizontally either', () => {
    // The y-axis guard above needs an x-axis twin, and asserting mesh.position.x against
    // body.aabb.x cannot be that twin: mesh.position.x is DERIVED from body.aabb.x, so a bob
    // leaking into the hitbox moves both sides together and the equality still holds. Watch
    // the hitbox against the velocity that is supposed to be the only thing moving it.
    const player = onGround()

    for (let i = 0; i < 400; i += 1) {
      const before = player.body.aabb.x
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      // The sweep advances the hitbox by velocity x dt, and by nothing else.
      expect(player.body.aabb.x - before).toBeCloseTo(player.body.velocity.x * FIXED_DT, 10)
    }
  })

  test('never touches the hitbox, through a long walking and jumping run', () => {
    const player = onGround()

    for (let i = 0; i < 600; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true, jump: i % 90 < 12 }))

      expect(player.body.aabb.w).toBe(PLAYER_WIDTH)
      expect(player.body.aabb.h).toBe(PLAYER_HEIGHT)
      // X is bit-exact on the centre: the bob is a Y-only offset.
      expect(player.mesh.position.x).toBe(player.body.aabb.x + PLAYER_WIDTH / 2)
      const lift = bobLift(player)
      expect(lift).toBeGreaterThanOrEqual(0)
      // bobLift subtracts the hitbox centre off an already-rounded sum (mesh.position.y is
      // IEEE 754 float64), so the recovered lift can sit one ULP above the cap; the upper
      // bound slack is exactly that.
      expect(lift).toBeLessThanOrEqual(BOB_AMPLITUDE + Number.EPSILON * Math.abs(player.mesh.position.y))
    }
  })

  test('the simulation runs identically whether or not there is a mesh to bob', () => {
    // Swap the real character for a bare Object3D and the body must trace the SAME numbers,
    // bit for bit: the simulation is invariant to which mesh instance it drives. This does not
    // catch a leak that is applied identically regardless of which mesh is present — see the
    // aabb.y and aabb.x guards above for that.
    const real = onGround()
    const stubbed = onGround(2, new THREE.Object3D())

    for (let i = 0; i < 400; i += 1) {
      const held = input({ moveX: i < 200 ? 1 : -1, right: i < 200, left: i >= 200, jump: i % 70 < 10 })
      real.step(FIXED_DT, held)
      stubbed.step(FIXED_DT, held)

      expect(stubbed.body.aabb.x).toBe(real.body.aabb.x)
      expect(stubbed.body.aabb.y).toBe(real.body.aabb.y)
      expect(stubbed.body.velocity.x).toBe(real.body.velocity.x)
      expect(stubbed.body.velocity.y).toBe(real.body.velocity.y)
      expect(stubbed.grounded).toBe(real.grounded)
    }
  })

  test('an injected stub mesh gets bobbed too', () => {
    const stub = new THREE.Object3D()
    const player = onGround(2, stub)
    expect(player.mesh).toBe(stub)

    let peak = 0
    for (let i = 0; i < 180; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      peak = Math.max(peak, bobLift(player))
    }

    expect(peak).toBeGreaterThan(BOB_AMPLITUDE / 2)
  })

  test('walking never touches the scale, which belongs to T-026', () => {
    const player = onGround()

    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      expect(player.mesh.scale.x).toBe(1)
      expect(player.mesh.scale.y).toBe(1)
      expect(player.mesh.scale.z).toBe(1)
    }
  })

  test('the landing squash and the bob run at once without either driving the other', () => {
    const player = onGround()
    const walking = input({ moveX: 1, right: true })
    stepFor(player, 40, walking)

    // Jump and hold the walk, so the landing is both squashed and moving.
    const jumping = input({ moveX: 1, right: true, jump: true })
    player.step(FIXED_DT, jumping)
    while (!player.grounded) player.step(FIXED_DT, jumping)
    expect(player.mesh.scale.y).toBeLessThan(1)

    // Within the squash recovery there is a frame where BOTH channels are live at once.
    let sawBoth = false
    for (let i = 0; i < 15; i += 1) {
      player.step(FIXED_DT, walking)
      if (player.mesh.scale.y < 1 && bobLift(player) > 0) sawBoth = true
    }
    expect(sawBoth).toBe(true)

    // And the squash still recovers to a bit-exact identity while the bob keeps going.
    stepFor(player, 60, walking)
    expect(player.mesh.scale.x).toBe(1)
    expect(player.mesh.scale.y).toBe(1)
    expect(player.mesh.scale.z).toBe(1)

    let peak = 0
    for (let i = 0; i < 120; i += 1) {
      player.step(FIXED_DT, walking)
      peak = Math.max(peak, bobLift(player))
      expect(player.mesh.scale.y).toBe(1)
    }
    expect(peak).toBeGreaterThan(BOB_AMPLITUDE / 2)
  })

  test('the T-033 character survives: still one merged, vertex-coloured mesh', () => {
    const player = onGround()
    stepFor(player, 60, input({ moveX: 1, right: true }))
    const mesh = player.mesh as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>

    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect(mesh.children).toHaveLength(0)
    expect(mesh.geometry).not.toBeInstanceOf(THREE.CapsuleGeometry)
    expect(mesh.geometry.getAttribute('color')).toBeDefined()
    expect(mesh.material.vertexColors).toBe(true)
  })
})
