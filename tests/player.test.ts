import { describe, expect, test } from 'vitest'
import {
  COYOTE_TIME_S,
  DASH_MAX,
  FIXED_DT,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER_S,
  JUMP_CUTOFF_FACTOR,
  JUMP_VELOCITY,
  TERMINAL_VELOCITY,
  TILE_SIZE,
  WALK_MAX,
  WALL_SLIDE_MAX_FALL,
} from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import type { InputState } from '../src/engine/input.ts'
import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  createDashInput,
  createPlayer,
} from '../src/entities/player/index.ts'
import type { Player, PlayerInput } from '../src/entities/player/index.ts'
import { BOB_AMPLITUDE } from '../src/entities/player/player.ts'

// Rows are written top-down for readability; tile Y is up, so row 0 is the highest ty.
// '#' solid, '.' empty.
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

/** Flat floor one tile deep, so the floor top is y = 1. */
function flatGround(width: number, height: number): TileGrid {
  const rows = Array.from({ length: height }, () => '.'.repeat(width))
  rows[height - 1] = '#'.repeat(width)
  return makeGrid(rows)
}

function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { jump: false, dash: false, moveX: 0, ...partial }
}

const NEUTRAL = input()

function stepFor(player: Player, frames: number, held: PlayerInput = NEUTRAL): void {
  for (let i = 0; i < frames; i += 1) player.step(FIXED_DT, held)
}

/** One step is enough to resolve a player spawned flush on the floor into grounded state. */
function settle(player: Player): Player {
  stepFor(player, 2)
  return player
}

function onGround(x = 2): Player {
  return settle(createPlayer({ x, y: 1, grid: flatGround(64, 8) }))
}

describe('player run', () => {
  test('accelerates at GROUND_ACCEL while grounded', () => {
    const player = onGround()

    player.step(FIXED_DT, input({ moveX: 1, right: true }))

    expect(player.body.velocity.x).toBeCloseTo(GROUND_ACCEL * FIXED_DT, 10)
  })

  test('never exceeds WALK_MAX and settles there', () => {
    const player = onGround()

    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      expect(player.body.velocity.x).toBeLessThanOrEqual(WALK_MAX + 1e-12)
    }

    expect(player.body.velocity.x).toBeCloseTo(WALK_MAX, 10)
  })

  test('friction brings a released run back to a stop', () => {
    const player = onGround()
    stepFor(player, 240, input({ moveX: 1, right: true }))

    stepFor(player, 120)

    expect(player.body.velocity.x).toBe(0)
  })
})

describe('player dash', () => {
  test('dash raises the speed cap to DASH_MAX', () => {
    const player = onGround()

    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true, dash: true }))
      expect(player.body.velocity.x).toBeLessThanOrEqual(DASH_MAX + 1e-12)
    }

    expect(player.body.velocity.x).toBeGreaterThan(WALK_MAX)
    expect(player.body.velocity.x).toBeCloseTo(DASH_MAX, 10)
  })

  test('releasing dash decays back down to WALK_MAX', () => {
    const player = onGround()
    stepFor(player, 240, input({ moveX: 1, right: true, dash: true }))

    stepFor(player, 120, input({ moveX: 1, right: true }))

    expect(player.body.velocity.x).toBeCloseTo(WALK_MAX, 10)
  })
})

describe('player jump', () => {
  test('jumping from the ground launches at JUMP_VELOCITY', () => {
    const player = onGround()
    expect(player.grounded).toBe(true)

    player.step(FIXED_DT, input({ jump: true }))

    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY, 10)
  })

  test('a launched jump spends the buffered press', () => {
    const player = onGround()

    player.step(FIXED_DT, input({ jump: true }))

    expect(Number.isFinite(player.jumpBuffer.timeSincePressed)).toBe(false)
  })

  test('holding jump does not launch a second time in mid-air', () => {
    const player = onGround()
    player.step(FIXED_DT, input({ jump: true }))
    const launched = player.body.velocity.y

    stepFor(player, 10, input({ jump: true }))

    expect(player.body.velocity.y).toBeLessThan(launched)
  })

  test('re-pressing jump inside the coyote window does not grant a second jump', () => {
    const player = onGround()
    player.step(FIXED_DT, input({ jump: true }))
    // Release, then press again while still rising and still inside the coyote window.
    stepFor(player, 4)
    const beforeRepress = player.body.velocity.y

    player.step(FIXED_DT, input({ jump: true }))

    expect(player.body.velocity.y).toBeLessThan(beforeRepress)
  })
})

describe('player coyote time', () => {
  /** Runs right off the ledge of a floor that ends at x = 4, returns once airborne. */
  function walkOffLedge(): Player {
    const grid = makeGrid([
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '####........',
    ])
    const player = settle(createPlayer({ x: 1, y: 1, grid }))

    for (let i = 0; i < 600 && player.grounded; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
    }
    expect(player.grounded).toBe(false)
    return player
  }

  test('a jump within COYOTE_TIME_S of leaving the ledge still launches', () => {
    const player = walkOffLedge()
    // 6 frames airborne = 50 ms, comfortably inside the 100 ms window.
    stepFor(player, 6)
    expect(player.coyote.timeSinceGrounded).toBeLessThan(COYOTE_TIME_S)

    player.step(FIXED_DT, input({ jump: true }))

    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY, 10)
  })

  test('a jump after COYOTE_TIME_S has expired does not launch', () => {
    const player = walkOffLedge()
    // 18 frames airborne = 150 ms, past the 100 ms window.
    stepFor(player, 18)
    expect(player.coyote.timeSinceGrounded).toBeGreaterThan(COYOTE_TIME_S)

    player.step(FIXED_DT, input({ jump: true }))

    expect(player.body.velocity.y).toBeLessThan(0)
  })
})

describe('player jump buffer', () => {
  const FALL_GRID = flatGround(16, 12)

  function falling(): Player {
    return createPlayer({ x: 4, y: 8, grid: FALL_GRID })
  }

  /** Frames of free fall before the player touches down, with no input at all. */
  function framesUntilLanding(): number {
    const probe = falling()
    for (let i = 1; i <= 600; i += 1) {
      probe.step(FIXED_DT, NEUTRAL)
      if (probe.grounded) return i
    }
    throw new Error('probe never landed')
  }

  /** Falls onto the floor, tapping jump `framesEarly` frames before touchdown. */
  function tapBeforeLanding(framesEarly: number): Player {
    const landing = framesUntilLanding()
    const player = falling()
    stepFor(player, landing - framesEarly)
    player.step(FIXED_DT, input({ jump: true }))
    while (!player.grounded) player.step(FIXED_DT, NEUTRAL)
    player.step(FIXED_DT, NEUTRAL)
    return player
  }

  test('a tap inside JUMP_BUFFER_S of touchdown fires on landing', () => {
    // 9 frames = 75 ms of buffer age by the time the jump is checked.
    const player = tapBeforeLanding(8)

    expect(9 * FIXED_DT).toBeLessThan(JUMP_BUFFER_S)
    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY, 10)
  })

  test('a tap older than JUMP_BUFFER_S is forgotten by touchdown', () => {
    // 41 frames = 342 ms of buffer age, well past the 120 ms window.
    const player = tapBeforeLanding(40)

    expect(41 * FIXED_DT).toBeGreaterThan(JUMP_BUFFER_S)
    expect(player.body.velocity.y).toBe(0)
    expect(player.grounded).toBe(true)
  })
})

describe('player variable jump', () => {
  test('releasing jump while rising cuts upward velocity by JUMP_CUTOFF_FACTOR', () => {
    const player = onGround()
    stepFor(player, 5, input({ jump: true }))
    const rising = player.body.velocity.y
    expect(rising).toBeGreaterThan(0)

    player.step(FIXED_DT, NEUTRAL)

    // Gravity for this step applies first, then the cutoff scales what is left.
    expect(player.body.velocity.y).toBeCloseTo((rising - GRAVITY * FIXED_DT) * JUMP_CUTOFF_FACTOR, 10)
  })

  test('the cutoff is applied once, not on every airborne frame', () => {
    const player = onGround()
    stepFor(player, 5, input({ jump: true }))
    player.step(FIXED_DT, NEUTRAL)
    const cut = player.body.velocity.y

    player.step(FIXED_DT, NEUTRAL)

    expect(player.body.velocity.y).toBeCloseTo(cut - GRAVITY * FIXED_DT, 10)
  })

  test('holding jump for the whole rise keeps the full arc', () => {
    const player = onGround()
    stepFor(player, 6, input({ jump: true }))

    expect(player.body.velocity.y).toBeCloseTo(JUMP_VELOCITY - GRAVITY * FIXED_DT * 5, 10)
  })
})

describe('player hitbox', () => {
  test('collides with the world through body.aabb, not a mesh', () => {
    const player = onGround()

    expect(player.body.aabb.w).toBeCloseTo(PLAYER_WIDTH, 10)
    expect(player.body.aabb.h).toBeCloseTo(PLAYER_HEIGHT, 10)
    // Resting bottom sits exactly on the floor top, not offset by a capsule radius.
    expect(player.body.aabb.y).toBeCloseTo(1, 10)
  })

  test('mesh transforms have no effect on collision resolution', () => {
    const player = onGround()
    const restingY = player.body.aabb.y
    const restingX = player.body.aabb.x

    player.mesh.scale.setScalar(4)
    player.mesh.position.set(99, 99, 99)
    stepFor(player, 10)

    expect(player.body.aabb.y).toBeCloseTo(restingY, 10)
    expect(player.body.aabb.x).toBeCloseTo(restingX, 10)
  })

  test('the mesh sits bit-exactly on the hitbox centre at rest', () => {
    const player = onGround()

    stepFor(player, 30)

    expect(player.mesh.position.x).toBe(player.body.aabb.x + PLAYER_WIDTH / 2)
    expect(player.mesh.position.y).toBe(player.body.aabb.y + PLAYER_HEIGHT / 2)
  })

  test('the mesh follows the hitbox centre, lifted only by the T-042 walk bob', () => {
    const player = onGround()

    stepFor(player, 30, input({ moveX: 1, right: true }))

    // X still tracks the centre exactly: the walk bob is a Y-only visual offset.
    expect(player.mesh.position.x).toBeCloseTo(player.body.aabb.x + PLAYER_WIDTH / 2, 10)
    // Y is the centre plus the bob, which is bounded and never dips below the rest pose.
    const lift = player.mesh.position.y - (player.body.aabb.y + PLAYER_HEIGHT / 2)
    expect(lift).toBeGreaterThanOrEqual(0)
    // lift is recovered by subtracting the hitbox centre off an already-rounded sum
    // (mesh.position.y is IEEE 754 float64), so it can sit one ULP above the cap.
    expect(lift).toBeLessThanOrEqual(BOB_AMPLITUDE + Number.EPSILON * Math.abs(player.mesh.position.y))
  })
})

describe('player facing', () => {
  test('turning lerps rotation.y toward Math.PI instead of snapping', () => {
    const player = onGround()
    stepFor(player, 30, input({ moveX: 1, right: true }))
    expect(player.mesh.rotation.y).toBeCloseTo(0, 6)

    player.step(FIXED_DT, input({ moveX: -1, left: true }))

    expect(player.mesh.rotation.y).toBeGreaterThan(0)
    expect(player.mesh.rotation.y).toBeLessThan(Math.PI)
  })

  test('a sustained turn settles facing left at Math.PI', () => {
    const player = onGround()
    stepFor(player, 30, input({ moveX: 1, right: true }))

    stepFor(player, 120, input({ moveX: -1, left: true }))

    expect(player.mesh.rotation.y).toBeCloseTo(Math.PI, 4)
    expect(player.facingYaw).toBeCloseTo(player.mesh.rotation.y, 10)
  })

  test('turning never flips scale.x — this is a 3D turn, not a sprite flip', () => {
    const player = onGround()

    stepFor(player, 30, input({ moveX: 1, right: true }))
    stepFor(player, 30, input({ moveX: -1, left: true }))

    expect(player.mesh.scale.x).toBe(1)
    expect(player.mesh.scale.y).toBe(1)
    expect(player.mesh.scale.z).toBe(1)
  })

  test('releasing the stick keeps the last facing', () => {
    const player = onGround()
    stepFor(player, 120, input({ moveX: -1, left: true }))
    const facing = player.facingYaw

    stepFor(player, 60)

    // Tolerance is loose enough for the lerp's asymptotic tail, tight enough that any
    // real facing change (which would be a swing of ~PI) fails.
    expect(player.facingYaw).toBeCloseTo(facing, 6)
  })
})

describe('player has no wall jump', () => {
  /** A shaft with a solid wall column at tx = 3; the player is pressed into it mid-air. */
  function againstWall(): Player {
    const rows = Array.from({ length: 11 }, () => '...#..')
    rows.push('######')
    // Right edge flush against the wall at x = 3.
    return createPlayer({ x: 3 - PLAYER_WIDTH, y: 8, grid: makeGrid(rows) })
  }

  test('jumping while pressed into a wall never launches or kicks off', () => {
    const player = againstWall()
    const startX = player.body.aabb.x
    let lowestVy = 0

    for (let i = 0; i < 60; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true, jump: true }))
      expect(player.body.velocity.y).toBeLessThanOrEqual(0)
      expect(player.body.velocity.x).toBeGreaterThanOrEqual(0)
      expect(player.body.aabb.x).toBeLessThanOrEqual(startX + 1e-12)
      lowestVy = Math.min(lowestVy, player.body.velocity.y)
    }

    // No wall slide either: the fall is never capped at WALL_SLIDE_MAX_FALL.
    expect(lowestVy).toBeLessThan(-WALL_SLIDE_MAX_FALL)
  })
})

describe('player has no ground pound', () => {
  test('down + jump in mid-air falls at plain gravity', () => {
    const player = createPlayer({ x: 4, y: 10, grid: flatGround(16, 16) })
    const slam = input({ down: true, jump: true, moveX: 0 })

    for (let i = 0; i < 60; i += 1) {
      const before = player.body.velocity.y
      player.step(FIXED_DT, slam)
      expect(player.body.velocity.y).toBeCloseTo(
        Math.max(before - GRAVITY * FIXED_DT, -TERMINAL_VELOCITY),
        10,
      )
    }
  })
})

describe('player dash input', () => {
  function engineState(partial: Partial<InputState> = {}): InputState {
    return { left: false, right: false, up: false, down: false, jump: false, moveX: 0, ...partial }
  }

  function key(type: 'keydown' | 'keyup', code: string): KeyboardEvent {
    return new KeyboardEvent(type, { code })
  }

  test('holding a Shift key sets dash', () => {
    const dash = createDashInput()
    const target = new EventTarget()
    dash.attach(target)

    target.dispatchEvent(key('keydown', 'ShiftLeft'))

    expect(dash.poll(engineState()).dash).toBe(true)
  })

  test('releasing Shift clears dash', () => {
    const dash = createDashInput()
    const target = new EventTarget()
    dash.attach(target)
    target.dispatchEvent(key('keydown', 'ShiftRight'))

    target.dispatchEvent(key('keyup', 'ShiftRight'))

    expect(dash.poll(engineState()).dash).toBe(false)
  })

  test('releasing one Shift while the other is held keeps dash', () => {
    const dash = createDashInput()
    const target = new EventTarget()
    dash.attach(target)
    target.dispatchEvent(key('keydown', 'ShiftLeft'))
    target.dispatchEvent(key('keydown', 'ShiftRight'))

    target.dispatchEvent(key('keyup', 'ShiftLeft'))

    expect(dash.poll(engineState()).dash).toBe(true)
  })

  test('other keys never set dash', () => {
    const dash = createDashInput()
    const target = new EventTarget()
    dash.attach(target)

    target.dispatchEvent(key('keydown', 'KeyD'))

    expect(dash.poll(engineState()).dash).toBe(false)
  })

  test('poll merges the engine snapshot into the player input', () => {
    const dash = createDashInput()

    const merged = dash.poll(engineState({ right: true, jump: true, down: true, moveX: 0.5 }))

    expect(merged.right).toBe(true)
    expect(merged.jump).toBe(true)
    expect(merged.down).toBe(true)
    expect(merged.left).toBe(false)
    expect(merged.up).toBe(false)
    expect(merged.moveX).toBe(0.5)
  })

  test('poll reuses one state object so the sim never sees a fresh reference', () => {
    const dash = createDashInput()

    expect(dash.poll(engineState())).toBe(dash.poll(engineState({ jump: true })))
    expect(dash.state).toBe(dash.poll(engineState()))
  })

  test('detaching clears the held Shift, so lost focus cannot stick dash on', () => {
    const dash = createDashInput()
    const target = new EventTarget()
    dash.attach(target)
    target.dispatchEvent(key('keydown', 'ShiftLeft'))

    dash.detach()

    expect(dash.poll(engineState()).dash).toBe(false)
  })

  test('attaching to a new target stops listening to the old one', () => {
    const dash = createDashInput()
    const first = new EventTarget()
    const second = new EventTarget()
    dash.attach(first)
    dash.attach(second)

    first.dispatchEvent(key('keydown', 'ShiftLeft'))

    expect(dash.poll(engineState()).dash).toBe(false)
  })
})
