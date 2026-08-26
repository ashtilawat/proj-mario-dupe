import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { START_LEVEL, startGame, type Game } from '../src/main'
import { loadLevel } from '../src/levels/index.ts'
import { STOMP_BOUNCE, TILE_SIZE } from '../src/physics/index.ts'
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
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

describe('walker spawning', () => {
  test('spawns one walker from the 1-1 spawn point, facing the way props say', () => {
    const { game } = start()

    expect(game.walkers).toHaveLength(1)
    const walker = game.walkers[0]!
    expect(walker.aabb.x).toBeCloseTo(16, 5)
    expect(walker.aabb.y).toBeCloseTo(1, 5)
    expect(walker.dir).toBe(-1)
    expect(walker.alive).toBe(true)
  })

  test('ignores level entities that are not walkers', () => {
    const { game } = start()
    const level = loadLevel(START_LEVEL)

    // 1-1 carries a `flag` entity at [22, 1] alongside the walker; only the walker
    // may become an enemy.
    expect(level.entities.length).toBeGreaterThan(1)
    expect(level.entities.some((entity) => entity.type === 'flag')).toBe(true)
    expect(game.walkers).toHaveLength(1)
    expect(game.walkers.some((walker) => walker.aabb.x === 22)).toBe(false)
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
