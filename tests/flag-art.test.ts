/**
 * T-039 — art for the level exit. Flags shipped as bare hitboxes: `createFlags` read the
 * `flag` entities into AABBs and nothing ever drew them, so the goal tile was invisible.
 *
 * Two halves. The first covers `src/entities/goal` on its own — where the pole stands, how
 * the banner hangs off it, what it frees. The second covers main.ts's wiring, and pins the
 * part that matters most about this ticket: it is art only. The hitbox, the level chain and
 * the fanfare are all covered elsewhere (tests/game-flow.test.ts, tests/wire-sfx.test.ts)
 * and must come through this change byte-identical.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import {
  BANNER_COLOR,
  BANNER_DROP,
  BANNER_HEIGHT,
  BANNER_WIDTH,
  FLAG_HEIGHT,
  FLAG_WIDTH,
  POLE_COLOR,
  POLE_HEIGHT,
  POLE_WIDTH,
  createFlag,
} from '../src/entities/goal/index.ts'
import { COIN_COLOR } from '../src/entities/pickups/index.ts'
import { TILE_SIZE } from '../src/physics/index.ts'
import { GAMEPLAY_Z } from '../src/render/index.ts'
import { START_LEVEL, createFlagArt, createFlags, startGame } from '../src/main'
import type { Game } from '../src/main'
import { elapseFlagToast } from './helpers/flag-toast.ts'
import { loadLevel } from '../src/levels/index.ts'

describe('the flag art', () => {
  test('stands the pole on the flag tile, centred in it', () => {
    const flag = createFlag({ x: 22, y: 1 })

    // The group is parked on the tile's bottom-left corner in world units, so every child
    // below is readable as an offset from the tile the level author placed.
    expect(flag.mesh.position.x).toBeCloseTo(22 * TILE_SIZE, 5)
    expect(flag.mesh.position.y).toBeCloseTo(1 * TILE_SIZE, 5)
    expect(flag.mesh.position.z).toBe(GAMEPLAY_Z)

    expect(flag.pole.position.x).toBeCloseTo((FLAG_WIDTH / 2) * TILE_SIZE, 5)
    // Base of the pole, not its centre: the art rises out of the tile rather than sinking
    // half a pole into the ground under it.
    expect(flag.pole.position.y - (POLE_HEIGHT * TILE_SIZE) / 2).toBeCloseTo(0, 5)
  })

  test('leaves the hitbox one tile however tall the art grows', () => {
    const flag = createFlag({ x: 22, y: 1 })

    expect(flag.aabb).toEqual({ x: 22, y: 1, w: FLAG_WIDTH, h: FLAG_HEIGHT })
    // Guards the assertion above: a pole no taller than its tile would make it vacuous.
    expect(POLE_HEIGHT).toBeGreaterThan(FLAG_HEIGHT)
  })

  test('hangs the banner off the pole, just under the top', () => {
    const flag = createFlag({ x: 22, y: 1 })
    flag.banner.geometry.computeBoundingBox()
    const box = flag.banner.geometry.boundingBox!

    // Flies from the pole's -X face with no gap, and hangs below the pole top rather than
    // above it — a pennant on a pole, not a rectangle floating beside one.
    const poleLeft = flag.pole.position.x - (POLE_WIDTH * TILE_SIZE) / 2
    expect(flag.banner.position.x + box.max.x).toBeCloseTo(poleLeft, 5)
    expect(flag.banner.position.y + box.max.y).toBeCloseTo(
      (POLE_HEIGHT - BANNER_DROP) * TILE_SIZE,
      5,
    )
    expect(flag.banner.position.y + box.min.y).toBeLessThan(POLE_HEIGHT * TILE_SIZE)

    expect(box.max.x - box.min.x).toBeCloseTo(BANNER_WIDTH * TILE_SIZE, 5)
    expect(box.max.y - box.min.y).toBeCloseTo(BANNER_HEIGHT * TILE_SIZE, 5)
  })

  test('keeps the art inside the tile column on its downstream side', () => {
    const flag = createFlag({ x: 17, y: 3 })
    flag.banner.geometry.computeBoundingBox()

    // 1-castle puts its flag on x=17 of an 18-wide level, and `followPlayer` clamps the
    // camera so the view can never show past the level's right edge. Anything the art hung
    // downstream of the pole would be cut in half there, so the banner flies back over the
    // ground the player just crossed instead.
    const rightmost = Math.max(
      flag.pole.position.x + (POLE_WIDTH * TILE_SIZE) / 2,
      flag.banner.position.x + flag.banner.geometry.boundingBox!.max.x,
    )
    expect(rightmost).toBeLessThanOrEqual(FLAG_WIDTH * TILE_SIZE)
  })

  test('carries its own colours, distinct from the coin gold', () => {
    const flag = createFlag({ x: 0, y: 0 })

    expect(flag.banner.material.color.getHex()).toBe(BANNER_COLOR)
    expect(flag.pole.material.color.getHex()).toBe(POLE_COLOR)
    expect(BANNER_COLOR).not.toBe(POLE_COLOR)
    // The exit must not read as a collectible at a glance.
    expect(BANNER_COLOR).not.toBe(COIN_COLOR)
  })

  test('holds the pole and the banner, and nothing else', () => {
    const flag = createFlag({ x: 3, y: 4, id: 2 })

    expect(flag.id).toBe(2)
    expect(flag.mesh.name).toBe('flag')
    expect(flag.mesh.children).toEqual([flag.pole, flag.banner])
  })

  test('frees both meshes on dispose', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const freed = [
      vi.spyOn(flag.pole.geometry, 'dispose'),
      vi.spyOn(flag.pole.material, 'dispose'),
      vi.spyOn(flag.banner.geometry, 'dispose'),
      vi.spyOn(flag.banner.material, 'dispose'),
    ]

    flag.dispose()

    for (const spy of freed) expect(spy).toHaveBeenCalledTimes(1)
  })
})

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
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
  started = game
  return { container, game }
}

/** Walks the player onto the 1-1 flag and runs the step that resolves it. */
function touchFlag(game: Game): void {
  const flag = loadLevel(START_LEVEL).entities.find((entity) => entity.type === 'flag')
  if (!flag) throw new Error('no flag in ' + START_LEVEL)
  game.player.body.aabb.x = flag.at[0]
  game.player.body.aabb.y = flag.at[1]
  game.loop.tick(1 / 120)
  // T-052: the touch only raises the level's line. The swap is on the far side of its beat.
  elapseFlagToast(game)
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

describe('reading a level flags into art', () => {
  test('draws nothing for a level with no exit', () => {
    // Most of World 1 has exactly one flag, so this is the case the shipped levels never
    // exercise: a bonus room or a boss arena whose exit is not a flag at all.
    expect(createFlagArt([])).toEqual([])
  })

  test('gives every flag its own pole and its own id', () => {
    const art = createFlagArt([
      { x: 4, y: 1, w: 1, h: 1 },
      { x: 9, y: 2, w: 1, h: 1 },
    ])

    expect(art.map((flag) => flag.id)).toEqual([0, 1])
    expect(art[0]!.mesh.position.x).toBeCloseTo(4 * TILE_SIZE, 5)
    expect(art[1]!.mesh.position.y).toBeCloseTo(2 * TILE_SIZE, 5)
    expect(art[0]!.mesh).not.toBe(art[1]!.mesh)
  })
})

describe('the flag art in the live scene', () => {
  test('hangs one flag under a tile-scaled layer, like the walkers and coins', () => {
    const { game } = start()

    const layer = game.scene.getObjectByName('flags')
    expect(layer).toBeDefined()
    expect(layer!.children).toHaveLength(createFlags(loadLevel(START_LEVEL)).length)
    // Flag art is authored in world units; the game draws one world unit per tile.
    expect(layer!.scale.x).toBeCloseTo(1 / TILE_SIZE, 5)
    expect(layer!.scale.y).toBeCloseTo(1 / TILE_SIZE, 5)
  })

  test('stands the art on the tile the hitbox reads', () => {
    const { game } = start()

    const hitbox = createFlags(loadLevel(START_LEVEL))[0]!
    const art = game.scene.getObjectByName('flags')!.children[0]!
    expect(art.position.x).toBeCloseTo(hitbox.x * TILE_SIZE, 5)
    expect(art.position.y).toBeCloseTo(hitbox.y * TILE_SIZE, 5)
  })

  test('rebuilds the art on the level the flag leads to', () => {
    const { game } = start()
    const stale = game.scene.getObjectByName('flags')!.children[0]!

    touchFlag(game)

    const next = createFlags(loadLevel('1-2'))
    const layer = game.scene.getObjectByName('flags')!
    expect(layer.children).toHaveLength(next.length)
    expect(layer.children).not.toContain(stale)
    expect(layer.children[0]!.position.x).toBeCloseTo(next[0]!.x * TILE_SIZE, 5)
  })

  test('frees the old level art when the flag swaps the world out', () => {
    const { game } = start()
    const stale = game.scene.getObjectByName('flags')!.children[0]!
    const freed = stale.children.map((part) =>
      vi.spyOn((part as THREE.Mesh).geometry, 'dispose'),
    )
    expect(freed).toHaveLength(2)

    touchFlag(game)

    // Seven levels of poles and pennants over a run: membership in the layer is not enough,
    // the GPU buffers have to go back too.
    for (const spy of freed) expect(spy).toHaveBeenCalledTimes(1)
    expect(stale.parent).toBeNull()
  })

  test('frees the live art on dispose', () => {
    const { game } = start()
    const live = game.scene.getObjectByName('flags')!.children[0]!
    const freed = live.children.flatMap((part) => [
      vi.spyOn((part as THREE.Mesh).geometry, 'dispose'),
      vi.spyOn((part as THREE.Mesh).material as THREE.Material, 'dispose'),
    ])
    expect(freed).toHaveLength(4)

    game.dispose()
    started = null

    for (const spy of freed) expect(spy).toHaveBeenCalledTimes(1)
  })

  test('leaves the hitbox reader untouched', () => {
    // The pre-T-039 contract, restated: art or no art, a flag is one tile on its `at`.
    const flag = loadLevel(START_LEVEL).entities.find((entity) => entity.type === 'flag')
    expect(flag).toBeDefined()
    expect(createFlags(loadLevel(START_LEVEL))).toEqual([{ x: flag!.at[0], y: flag!.at[1], w: 1, h: 1 }])
  })

  test('takes the layer out of the scene on dispose', () => {
    const { game } = start()
    const layer = game.scene.getObjectByName('flags')!

    game.dispose()
    started = null

    expect(layer.parent).toBeNull()
  })
})
