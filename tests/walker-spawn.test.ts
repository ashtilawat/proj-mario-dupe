import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { START_LEVEL, startGame, type Game } from '../src/main'
import { loadLevel } from '../src/levels/index.ts'
import { STOMP_BOUNCE, TILE_SIZE } from '../src/physics/index.ts'

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
    // Overlapping the walker from below, moving up: a stomp must need a downward fall.
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 1.5
    game.player.body.velocity.y = 6

    game.loop.tick(1 / 120)

    expect(walker.alive).toBe(true)
    expect(game.player.body.velocity.y).not.toBe(STOMP_BOUNCE)
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
