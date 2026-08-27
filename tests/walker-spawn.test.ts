import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { START_LEVEL, startGame, type Game } from '../src/main'
import { loadLevel } from '../src/levels/index.ts'
import { STOMP_BOUNCE, TILE_SIZE, overlaps } from '../src/physics/index.ts'
import { createWalker } from '../src/entities/enemies/walker.ts'

/** jsdom ships no WebGL; every test drives the real wiring through this stub. */
function stubRenderer() {
  return {
    domElement: document.createElement('canvas'),
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  }
}

let started: Game | null = null

function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
  // T-028: the title card gates the sim until Enter, so a test run starts the way a player
  // starts one. The card itself is covered by tests/title-flow.test.ts.
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

describe('walker spawning', () => {
  test('spawns one walker per walker entity from the 1-1 JSON, facing the way props say', () => {
    const { game } = start()
    const named = loadLevel(START_LEVEL).entities.filter((entity) => entity.type === 'walker')
    const first = named[0]!

    expect(game.walkers).toHaveLength(named.length)
    const walker = game.walkers.find((w) => w.aabb.x === first.at[0] && w.aabb.y === first.at[1])
    expect(walker).toBeDefined()
    expect(walker!.aabb.x).toBeCloseTo(first.at[0], 5)
    expect(walker!.aabb.y).toBeCloseTo(first.at[1], 5)
    expect(walker!.dir).toBe(first.props?.dir === -1 ? -1 : 1)
    expect(walker!.alive).toBe(true)
  })

  test('ignores level entities that are not walkers', () => {
    const { game } = start()
    const level = loadLevel(START_LEVEL)
    const named = level.entities.filter((entity) => entity.type === 'walker')
    const flag = level.entities.find((entity) => entity.type === 'flag')

    // 1-1 carries a flag (and coins) alongside the walkers; only walkers may become enemies.
    expect(level.entities.length).toBeGreaterThan(named.length)
    expect(flag).toBeDefined()
    expect(game.walkers).toHaveLength(named.length)
    expect(game.walkers.some((walker) => walker.aabb.x === flag!.at[0])).toBe(false)
  })

  test('adds the walker meshes to the scene under a tile-scaled layer', () => {
    const { game } = start()
    const layer = game.scene.getObjectByName('walkers')

    expect(layer).toBeInstanceOf(THREE.Group)
    expect(game.scene.children).toContain(layer)
    expect(layer!.scale.x).toBeCloseTo(1 / TILE_SIZE, 10)
    expect(layer!.children).toContain(game.walkers[0]!.mesh)
  })

  test('renders the walker on its hitbox, in tile units', () => {
    const { game } = start()
    game.scene.updateMatrixWorld(true)

    // Hitbox is [16, 17] x [1, 2] in tiles, so the box centre is (16.5, 1.5).
    const position = game.walkers[0]!.mesh.getWorldPosition(new THREE.Vector3())
    expect(position.x).toBeCloseTo(16.5, 5)
    expect(position.y).toBeCloseTo(1.5, 5)
    expect(position.z).toBeCloseTo(0, 5)
  })

  test('keeps the tile batch the only instanced mesh in the scene', () => {
    const { game } = start()

    const instanced = game.scene.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )
    expect(instanced).toHaveLength(1)
  })
})

describe('walker patrol', () => {
  test('steps each walker once per fixed sim step', () => {
    const { game } = start()
    const walker = game.walkers[0]!

    // 30 frames at 1/60 is 60 fixed steps = 0.5s. Patrol speed is WALK_MAX / 3 = 2 tiles/s,
    // and dir is -1, so the walker should have strolled exactly one tile to the left.
    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).toBeCloseTo(15, 5)
  })

  test('keeps the patrolling walker resting on the floor', () => {
    const { game } = start()
    const walker = game.walkers[0]!

    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    // Proves the walker both moved (didn't stay parked at spawn x=16) and stayed grounded
    // while doing so.
    expect(walker.aabb.x).toBeLessThan(16)
    expect(walker.aabb.y).toBeCloseTo(1, 5)
  })

  test('keeps the mesh following the hitbox as it walks', () => {
    const { game } = start()
    const walker = game.walkers[0]!

    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)
    game.scene.updateMatrixWorld(true)

    // Proves the mesh actually left its spawn position (rather than trivially matching a
    // stationary hitbox) while still tracking the hitbox centre.
    const position = walker.mesh.getWorldPosition(new THREE.Vector3())
    expect(position.x).toBeLessThan(16.5)
    expect(position.x).toBeCloseTo(walker.aabb.x + 0.5, 5)
    expect(position.y).toBeCloseTo(walker.aabb.y + 0.5, 5)
  })
})

describe('stomping a walker', () => {
  /** Parks the player directly on top of the 1-1 walker, falling. */
  function dropPlayerOnWalker(game: Game, vy: number) {
    const aabb = game.player.body.aabb
    aabb.x = 16.2
    aabb.y = 2
    game.player.body.velocity.x = 0
    game.player.body.velocity.y = vy
  }

  test('bounces the player off a stomped walker', () => {
    const { game } = start()
    dropPlayerOnWalker(game, -6)

    game.loop.tick(1 / 120)

    expect(game.player.body.velocity.y).toBe(STOMP_BOUNCE)
  })

  test('defeats the stomped walker in place', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    dropPlayerOnWalker(game, -6)

    game.loop.tick(1 / 120)

    expect(walker.alive).toBe(false)
    expect(walker.stomped).toBe(true)
  })

  test('hides the defeated walker', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    dropPlayerOnWalker(game, -6)

    game.loop.tick(1 / 120)

    expect(walker.mesh.visible).toBe(false)
  })

  test('leaves a defeated walker inert for the rest of the level', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    dropPlayerOnWalker(game, -6)
    game.loop.tick(1 / 120)
    const restingX = walker.aabb.x

    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).toBeCloseTo(restingX, 5)
    expect(walker.alive).toBe(false)
  })

  test('does not stomp a walker the player is rising into', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    // Proves a player moving upward while overlapping the walker is not stomped,
    // regardless of which internal check inside tryStomp is what rejects it.
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 1.5
    game.player.body.velocity.y = 6

    game.loop.tick(1 / 120)

    expect(walker.alive).toBe(true)
    expect(game.player.body.velocity.y).not.toBe(STOMP_BOUNCE)
  })

  test('stomps on the fall the player had before the step, not the landing that zeroed it', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    dropPlayerOnWalker(game, -6)

    // A real landing zeroes vy inside moveAndCollide, and no single 1/120 step on the 1-1
    // floor both overlaps the walker and lands. So reproduce just the zeroing: run the real
    // step, then clear vy the way a floor hit would. simulate captures the pre-step values
    // before it calls this, so only the post-step read is poisoned by the wrapper.
    const innerStep = game.player.step.bind(game.player)
    game.player.step = (dt, input) => {
      innerStep(dt, input)
      game.player.body.velocity.y = 0
    }

    game.loop.tick(1 / 120)

    expect(walker.alive).toBe(false)
    expect(walker.mesh.visible).toBe(false)
    expect(game.player.body.velocity.y).toBe(STOMP_BOUNCE)
  })

  test('costs one life for a side hit, and only one while the i-frames run', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 1
    game.player.body.velocity.x = 0
    game.player.body.velocity.y = 0
    // Standing on the floor the walker patrols, so the contact is a side hit twice over:
    // the player is not falling (vy is 0) and their feet started below the walker's top.
    expect(game.hud.getState().lives).toBe(3)

    game.loop.tick(1 / 120)

    expect(game.hud.getState().lives).toBe(2)
    expect(walker.alive).toBe(true)

    // Still overlapping on the next step — the i-frames have to swallow it, or one jump
    // through a walker would cost two of the player's three lives.
    game.loop.tick(1 / 120)

    expect(game.hud.getState().lives).toBe(2)
  })

  /**
   * T-034. A one-tile walker WALKS BACK OUT of the player: at 2 tiles/s (WALK_MAX / 3) it
   * clears the 0.7-wide player box 0.4 s after first touching it here, well inside the 1 s
   * i-frame window, so the bump bills one life and the contact is over before the window
   * reopens. That the contact ENDS is a property of the one-tile hitbox, and it is the
   * property the reported bug would break: an AABB inflated to the mushroom's 16-unit
   * world bounds swallows the player and never stops overlapping, so the window reopens
   * and bills again, and again, to GAME OVER.
   *
   * 1.5 s is deliberate on both sides. Shorter would not outlast the i-frames, so a second
   * bill could hide past the end of the loop; longer would catch the walker coming back
   * off its pit-rim turn at ~2.6 s, which is a second, legitimate bump.
   *
   * What is NOT pinned here, because the fix lives in main.ts and is out of this ticket's
   * scope: `invuln` is a plain 1 s timer rather than being scoped to the contact, and the
   * walker's ledge turn can hold it inside a standing player for longer than that. A
   * player standing at x = 13.8 loses two lives to ONE unbroken 1.525 s contact (bills at
   * t = 0.75 s and t = 1.758 s). See docs/superpowers/plans/2026-08-26-t034-walker-hitbox.md.
   */
  test('a one-tile walker walks back out, so one bump bills one life', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 1
    game.player.body.velocity.x = 0
    game.player.body.velocity.y = 0

    let contactEndedAt = -1
    let lowest = game.hud.getState().lives
    for (let i = 1; i <= 180; i += 1) {
      game.loop.tick(1 / 120)
      if (contactEndedAt < 0 && !overlaps(game.player.body.aabb, walker.aabb)) {
        contactEndedAt = i / 120
      }
      lowest = Math.min(lowest, game.hud.getState().lives)
    }

    // The walker let go, and it did so before the i-frames ran out.
    expect(contactEndedAt).toBeGreaterThan(0)
    expect(contactEndedAt).toBeLessThan(1)
    expect(lowest).toBe(2)
    expect(game.hud.getState().lives).toBe(2)
    expect(walker.alive).toBe(true)
  })

  test('does not also charge a life for the walker it just stomped', () => {
    const { game } = start()
    dropPlayerOnWalker(game, -6)

    game.loop.tick(1 / 120)

    expect(game.player.body.velocity.y).toBe(STOMP_BOUNCE)
    expect(game.hud.getState().lives).toBe(3)
  })

  /**
   * A second walker shoulder to shoulder with the 1-1 one, both under the player. `walkers`
   * is the very array `simulate` iterates, so pushing onto it is enough — the extra mesh
   * never needs to reach the scene for the simulation to see the enemy.
   */
  function addSecondWalker(game: Game) {
    const walker = createWalker({ x: 16.5, y: 1, dir: 1, id: 1 })
    game.walkers.push(walker)
    return walker
  }

  test('stomps every walker under one fall, whatever the first bounce did to velocity', () => {
    const { game } = start()
    const first = game.walkers[0]!
    const second = addSecondWalker(game)
    dropPlayerOnWalker(game, -6)

    game.loop.tick(1 / 120)

    // Both were caught by the same fall, so both die. Reading velocity.y inside the loop
    // instead of once before the step would let the first bounce turn it positive and hide
    // the second walker behind tryStomp's own stomperVy >= 0 guard.
    expect(first.alive).toBe(false)
    expect(second.alive).toBe(false)
  })

  test('costs only one life when two walkers overlap the player in the same tick', () => {
    const { game } = start()
    const second = addSecondWalker(game)
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 1
    game.player.body.velocity.x = 0
    game.player.body.velocity.y = 0

    game.loop.tick(1 / 120)

    // Arming the i-frames only after the loop would bill both walkers and strip two of the
    // player's three lives for a single jump.
    expect(second.alive).toBe(true)
    expect(game.hud.getState().lives).toBe(2)
  })

  test('leaves an untouched walker alone while the player idles', () => {
    const { game } = start()
    const walker = game.walkers[0]!

    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    expect(walker.alive).toBe(true)
    expect(walker.mesh.visible).toBe(true)
  })

  test('still shows exactly one debug hitbox — walkers stay off the overlay', () => {
    const { game } = start()

    game.loop.tick(1 / 60)

    expect(game.overlay.group.getObjectByName('debug-hitboxes')?.children.length).toBe(1)
    expect(game.overlay.group.getObjectByName('debug-velocities')?.children.length).toBe(1)
  })
})
