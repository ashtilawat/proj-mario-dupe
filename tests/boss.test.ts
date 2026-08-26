import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { STOMP_BOUNCE, TILE_SIZE, top } from '../src/physics/index.ts'
import type { Aabb, TileGrid, TileKind } from '../src/physics/index.ts'
import * as bossModule from '../src/entities/bosses/standin.ts'
import {
  BOSS_HEIGHT,
  BOSS_MESH_DEPTH,
  BOSS_MESH_HEIGHT,
  BOSS_MESH_WIDTH,
  BOSS_WIDTH,
  createBossStandin,
} from '../src/entities/bosses/standin.ts'
import type { BossStandin } from '../src/entities/bosses/standin.ts'

// Rows are written top-down for readability; tile Y is up, so row 0 is the highest ty.
// '#' solid, '.' empty. Same stub shape tests/walker.test.ts and tests/physics.test.ts use.
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

const DT = 1 / 120

// Wide, tall walled arena: a long floor for the charge and plenty of headroom for the
// jump-slam. Floor top is y = 1, side walls at tx 0 and tx 23.
const ARENA = makeGrid([
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '#......................#',
  '########################',
])

const SPAWN = { x: 10, y: 1 }

/** "Small" player hitbox from the PRD size table. */
const SMALL_W = 0.6
const SMALL_H = 0.8

function spawnBoss(): BossStandin {
  return createBossStandin(SPAWN)
}

/** A Small-size stomper landing squarely on the boss's head this frame. */
function smallStompFromAbove(boss: BossStandin): number {
  const headY = top(boss.aabb)
  const box: Aabb = { x: boss.aabb.x + 1, y: headY - 0.1, w: SMALL_W, h: SMALL_H }
  return boss.tryStomp(box, -10, headY + 0.2)
}

function stepUntil(boss: BossStandin, done: (b: BossStandin) => boolean, maxSteps = 2400): number {
  for (let i = 0; i < maxSteps; i += 1) {
    if (done(boss)) return i
    boss.step(DT, ARENA)
  }
  return -1
}

function snapshot(boss: BossStandin): Record<string, unknown> {
  return {
    x: boss.aabb.x,
    y: boss.aabb.y,
    vx: boss.velocity.x,
    vy: boss.velocity.y,
    phase: boss.phase,
    state: boss.state,
    telegraphing: boss.telegraphing,
  }
}

// Read from disk rather than through the module graph: these checks are about what the
// source says, not about what the bundler produced. Vitest runs from the project root.
const SOURCE_PATH = 'src/entities/bosses/standin.ts'
const SOURCE = readFileSync(SOURCE_PATH, 'utf8')

describe('createBossStandin', () => {
  test('starts alive in phase 1, idle and not yet telegraphing', () => {
    const boss = spawnBoss()

    expect(boss.phase).toBe(1)
    expect(boss.alive).toBe(true)
    expect(boss.defeated).toBe(false)
    expect(boss.state).toBe('idle')
    expect(boss.telegraphing).toBe(false)
    expect(boss.aabb.x).toBe(SPAWN.x)
    expect(boss.aabb.y).toBe(SPAWN.y)
  })

  test('hitbox is a large AABB in tile space', () => {
    const boss = spawnBoss()

    expect(boss.aabb.w).toBeGreaterThanOrEqual(3)
    expect(boss.aabb.h).toBeGreaterThanOrEqual(2)
  })
})

describe('phase 1 — telegraphed slam', () => {
  test('telegraphs before the upward slam impulse', () => {
    const boss = spawnBoss()
    let firstTelegraphTick = -1
    let firstLaunchTick = -1

    for (let i = 0; i < 600; i += 1) {
      boss.step(DT, ARENA)
      if (firstTelegraphTick < 0 && boss.telegraphing) firstTelegraphTick = i
      // Resting on the floor the sweep zeroes vy every tick, so vy > 0 is the slam launch.
      if (firstLaunchTick < 0 && boss.velocity.y > 0) firstLaunchTick = i
    }

    expect(firstTelegraphTick).toBeGreaterThanOrEqual(0)
    expect(firstLaunchTick).toBeGreaterThanOrEqual(0)
    expect(firstTelegraphTick).toBeLessThan(firstLaunchTick)
  })

  test('holds still while telegraphing, then attacks, then recovers', () => {
    const boss = spawnBoss()

    expect(stepUntil(boss, (b) => b.telegraphing)).toBeGreaterThan(0)
    expect(boss.state).toBe('telegraph')
    expect(boss.telegraphRemaining).toBeGreaterThan(0)
    expect(boss.attackRemaining).toBe(0)
    expect(boss.velocity.x).toBe(0)
    expect(boss.velocity.y).toBeLessThanOrEqual(0)

    expect(stepUntil(boss, (b) => b.state === 'attack')).toBeGreaterThan(0)
    expect(boss.telegraphing).toBe(false)
    expect(boss.attackRemaining).toBeGreaterThan(0)

    expect(stepUntil(boss, (b) => b.state === 'recover')).toBeGreaterThan(0)
    // The slam ends back on the floor it launched from.
    expect(boss.aabb.y).toBeCloseTo(SPAWN.y, 6)
  })

  test('leaves the ground during the phase 1 attack and lands again', () => {
    const boss = spawnBoss()
    stepUntil(boss, (b) => b.state === 'attack')

    let peak = boss.aabb.y
    for (let i = 0; i < 600 && boss.state === 'attack'; i += 1) {
      boss.step(DT, ARENA)
      peak = Math.max(peak, boss.aabb.y)
    }

    expect(peak).toBeGreaterThan(SPAWN.y + 0.5)
    expect(boss.state).toBe('recover')
    expect(boss.aabb.y).toBeCloseTo(SPAWN.y, 6)
  })
})

describe('phase 2 — telegraphed charge', () => {
  test('telegraphs before the horizontal charge', () => {
    const boss = spawnBoss()
    expect(smallStompFromAbove(boss)).toBe(STOMP_BOUNCE)
    expect(boss.phase).toBe(2)

    let firstTelegraphTick = -1
    let firstChargeTick = -1
    for (let i = 0; i < 600; i += 1) {
      boss.step(DT, ARENA)
      if (firstTelegraphTick < 0 && boss.telegraphing) firstTelegraphTick = i
      if (firstChargeTick < 0 && boss.velocity.x !== 0) firstChargeTick = i
    }

    expect(firstTelegraphTick).toBeGreaterThanOrEqual(0)
    expect(firstChargeTick).toBeGreaterThanOrEqual(0)
    expect(firstTelegraphTick).toBeLessThan(firstChargeTick)
  })

  test('charges horizontally along the floor and then recovers', () => {
    const boss = spawnBoss()
    smallStompFromAbove(boss)
    stepUntil(boss, (b) => b.state === 'attack')
    const startX = boss.aabb.x

    stepUntil(boss, (b) => b.state === 'recover')

    expect(Math.abs(boss.aabb.x - startX)).toBeGreaterThan(1)
    expect(boss.aabb.y).toBeCloseTo(SPAWN.y, 6)
  })

  test('alternates charge direction deterministically', () => {
    const boss = spawnBoss()
    smallStompFromAbove(boss)

    stepUntil(boss, (b) => b.state === 'attack')
    const firstDir = Math.sign(boss.velocity.x)
    stepUntil(boss, (b) => b.state === 'recover')
    stepUntil(boss, (b) => b.state === 'attack')
    const secondDir = Math.sign(boss.velocity.x)

    expect(firstDir).not.toBe(0)
    expect(secondDir).toBe(-firstDir)
  })
})

describe('phase 3 — telegraphed jump slam', () => {
  test('telegraphs before the jump and reaches higher than the phase 1 hop', () => {
    const boss = spawnBoss()
    smallStompFromAbove(boss)
    smallStompFromAbove(boss)
    expect(boss.phase).toBe(3)

    let firstTelegraphTick = -1
    let firstLaunchTick = -1
    let peak = boss.aabb.y
    for (let i = 0; i < 900; i += 1) {
      boss.step(DT, ARENA)
      if (firstTelegraphTick < 0 && boss.telegraphing) firstTelegraphTick = i
      if (firstLaunchTick < 0 && boss.velocity.y > 0) firstLaunchTick = i
      peak = Math.max(peak, boss.aabb.y)
    }

    expect(firstTelegraphTick).toBeGreaterThanOrEqual(0)
    expect(firstLaunchTick).toBeGreaterThanOrEqual(0)
    expect(firstTelegraphTick).toBeLessThan(firstLaunchTick)
    expect(peak).toBeGreaterThan(SPAWN.y + 2)
  })

  test('slams back down to the floor', () => {
    const boss = spawnBoss()
    smallStompFromAbove(boss)
    smallStompFromAbove(boss)
    stepUntil(boss, (b) => b.state === 'attack')
    stepUntil(boss, (b) => b.state === 'recover')

    expect(boss.aabb.y).toBeCloseTo(SPAWN.y, 6)
  })
})

describe('determinism', () => {
  test('two bosses fed the same dt sequence stay in lockstep', () => {
    const a = spawnBoss()
    const b = spawnBoss()
    const trackA: Record<string, unknown>[] = []
    const trackB: Record<string, unknown>[] = []

    for (let i = 0; i < 900; i += 1) {
      a.step(DT, ARENA)
      b.step(DT, ARENA)
      trackA.push(snapshot(a))
      trackB.push(snapshot(b))
    }

    expect(trackA).toEqual(trackB)
    // Not a flat trace: the phase pattern actually moved the boss around.
    expect(new Set(trackA.map((s) => s['state'])).size).toBeGreaterThan(1)
  })

  test('the same stomp script produces the same fight both times', () => {
    const run = (): Record<string, unknown>[] => {
      const boss = spawnBoss()
      const track: Record<string, unknown>[] = []
      for (let i = 0; i < 900; i += 1) {
        boss.step(DT, ARENA)
        if (i === 200 || i === 400) smallStompFromAbove(boss)
        track.push(snapshot(boss))
      }
      return track
    }

    expect(run()).toEqual(run())
  })
})

describe('stomping', () => {
  test('a Small stomper from above advances phase 1 to phase 2 and bounces', () => {
    const boss = spawnBoss()

    const bounce = smallStompFromAbove(boss)

    expect(bounce).toBe(STOMP_BOUNCE)
    expect(bounce).toBe(15)
    expect(boss.phase).toBe(2)
    expect(boss.alive).toBe(true)
    expect(boss.defeated).toBe(false)
  })

  test('three Small stomps defeat it', () => {
    const boss = spawnBoss()

    expect(smallStompFromAbove(boss)).toBe(STOMP_BOUNCE)
    expect(boss.phase).toBe(2)
    expect(smallStompFromAbove(boss)).toBe(STOMP_BOUNCE)
    expect(boss.phase).toBe(3)
    expect(smallStompFromAbove(boss)).toBe(STOMP_BOUNCE)

    expect(boss.alive).toBe(false)
    expect(boss.defeated).toBe(true)
    expect(boss.state).toBe('dead')
    expect(boss.stompCount).toBe(3)
  })

  test('is beatable at Small size across a live fight', () => {
    const boss = spawnBoss()

    for (let i = 0; i < 2400 && boss.alive; i += 1) {
      boss.step(DT, ARENA)
      if (i % 300 === 299) smallStompFromAbove(boss)
    }

    expect(boss.defeated).toBe(true)
    expect(boss.alive).toBe(false)
  })

  test('a defeated boss cannot be stomped again and stops moving', () => {
    const boss = spawnBoss()
    smallStompFromAbove(boss)
    smallStompFromAbove(boss)
    smallStompFromAbove(boss)
    const restingX = boss.aabb.x

    expect(smallStompFromAbove(boss)).toBe(0)
    for (let i = 0; i < 120; i += 1) boss.step(DT, ARENA)

    expect(boss.aabb.x).toBe(restingX)
    expect(boss.velocity.x).toBe(0)
    expect(boss.velocity.y).toBe(0)
  })

  test('a stomp during the telegraph counts', () => {
    const boss = spawnBoss()
    stepUntil(boss, (b) => b.telegraphing)
    expect(boss.telegraphing).toBe(true)

    expect(smallStompFromAbove(boss)).toBe(STOMP_BOUNCE)
    expect(boss.phase).toBe(2)
  })

  test('a stomp during the attack counts', () => {
    const boss = spawnBoss()
    stepUntil(boss, (b) => b.state === 'attack')
    expect(boss.state).toBe('attack')

    expect(smallStompFromAbove(boss)).toBe(STOMP_BOUNCE)
    expect(boss.phase).toBe(2)
  })

  test('a side bump does not advance the phase', () => {
    const boss = spawnBoss()

    const bounce = boss.tryStomp({ x: boss.aabb.x - 0.4, y: SPAWN.y, w: SMALL_W, h: SMALL_H }, 0, SPAWN.y)

    expect(bounce).toBe(0)
    expect(boss.phase).toBe(1)
    expect(boss.stompCount).toBe(0)
  })

  test('a hit from below does not advance the phase', () => {
    const boss = spawnBoss()

    const bounce = boss.tryStomp({ x: boss.aabb.x + 1, y: SPAWN.y + 0.2, w: SMALL_W, h: SMALL_H }, 8, SPAWN.y)

    expect(bounce).toBe(0)
    expect(boss.phase).toBe(1)
  })

  test('a falling stomper scraping down the side does not advance the phase', () => {
    const boss = spawnBoss()
    const headY = top(boss.aabb)

    const bounce = boss.tryStomp(
      { x: boss.aabb.x - 0.4, y: headY - 1, w: SMALL_W, h: SMALL_H },
      -10,
      headY - 0.5,
    )

    expect(bounce).toBe(0)
    expect(boss.phase).toBe(1)
  })
})

/** One flat-coloured part of the merged geometry: its colour and local bounds. */
interface Part {
  color: THREE.Color
  minY: number
  maxY: number
  maxZ: number
  halfWidth: number
  /** Every distinct X the part's vertices sit on: box edges, so two per box. */
  edgesX: number[]
}

/**
 * Split the merged geometry into parts by vertex colour, topmost first. The same helper
 * tests/player-art.test.ts uses, plus `maxZ` and `edgesX`. Partitioning by colour rather
 * than by a Y band is what lets the seam test see the joins: adjacent parts' Y spans are
 * allowed to intersect.
 */
function meshParts(geometry: THREE.BufferGeometry): Part[] {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  const byColor = new Map<string, Part>()
  const edges = new Map<string, Set<number>>()

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const key = [color.getX(i), color.getY(i), color.getZ(i)].join(',')
    const part = byColor.get(key)

    if (part) {
      part.minY = Math.min(part.minY, y)
      part.maxY = Math.max(part.maxY, y)
      part.maxZ = Math.max(part.maxZ, z)
      part.halfWidth = Math.max(part.halfWidth, Math.abs(x))
    } else {
      const rgb = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i))
      byColor.set(key, {
        color: rgb,
        minY: y,
        maxY: y,
        maxZ: z,
        halfWidth: Math.abs(x),
        edgesX: [],
      })
      edges.set(key, new Set())
    }
    // Rounded, because the merged attribute is Float32 and a box edge lands a few ulps off.
    edges.get(key)!.add(Math.round(x * 1000) / 1000)
  }

  for (const [key, part] of byColor) part.edgesX = [...edges.get(key)!].sort((a, b) => a - b)
  return [...byColor.values()].sort((a, b) => b.maxY - a.maxY)
}

/** The king, top to bottom, as the colour partition orders him. */
function kingParts(): [Part, Part, Part, Part, Part, Part, Part] {
  return meshParts(spawnBoss().mesh.geometry) as [Part, Part, Part, Part, Part, Part, Part]
}

describe('king mesh', () => {
  test('is one Mesh with a single Lambert material and no geometry groups', () => {
    const boss = spawnBoss()

    expect(boss.mesh).toBeInstanceOf(THREE.Mesh)
    // A Group of child meshes would slip straight past the `mesh.geometry.dispose();
    // mesh.material.dispose()` idiom main.ts frees every boss with.
    expect(boss.mesh.children).toHaveLength(0)
    expect(Array.isArray(boss.mesh.material)).toBe(false)
    expect(boss.mesh.material).not.toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(boss.mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(boss.mesh.material.vertexColors).toBe(true)
    // Groups would demand a material array, which a single dispose() cannot free.
    expect(boss.mesh.geometry.groups).toHaveLength(0)
    expect(boss.mesh.position.z).toBe(0)
  })

  test('carries a per-vertex colour attribute', () => {
    const geometry = spawnBoss().mesh.geometry

    expect(geometry.type).toBe('BufferGeometry')
    const color = geometry.getAttribute('color')
    expect(color).toBeDefined()
    expect(color.itemSize).toBe(3)
    expect(color.count).toBe(geometry.getAttribute('position').count)
  })

  test('is a crowned character, not the flat gray box', () => {
    const boss = spawnBoss()

    expect(boss.mesh.geometry).not.toBeInstanceOf(THREE.BoxGeometry)
    // Hem, robe, collar, head, crown band, crown points, jewel: the box had one colour.
    expect(meshParts(boss.mesh.geometry)).toHaveLength(7)
  })

  test('fills its own silhouette bounds, centred on the origin', () => {
    const geometry = spawnBoss().mesh.geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const size = box.getSize(new THREE.Vector3())

    // Measured against the art's own spans, not the hitbox: the whole point of BOSS_MESH_*
    // is that retuning BOSS_HEIGHT must not drag the king with it.
    expect(size.x).toBeCloseTo(BOSS_MESH_WIDTH * TILE_SIZE, 3)
    expect(size.y).toBeCloseTo(BOSS_MESH_HEIGHT * TILE_SIZE, 3)
    expect(size.z).toBeCloseTo(BOSS_MESH_DEPTH * TILE_SIZE, 3)

    // syncMesh parks the mesh on the hitbox centre, so an off-centre silhouette would sink
    // the robe into the floor or float it above.
    const center = box.getCenter(new THREE.Vector3())
    expect(center.x).toBeCloseTo(0, 3)
    expect(center.y).toBeCloseTo(0, 3)
    expect(center.z).toBeCloseTo(0, 3)
  })

  test('is still a wall of a creature next to the 1-tile walker', () => {
    const geometry = spawnBoss().mesh.geometry
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())

    expect(size.x).toBeGreaterThan(TILE_SIZE)
    expect(size.y).toBeGreaterThan(TILE_SIZE)
    expect(size.x).toBeGreaterThanOrEqual(3 * TILE_SIZE)
    expect(size.y).toBeGreaterThanOrEqual(3 * TILE_SIZE)
  })

  test('art is decoration: the hitbox is the same 3x3 it always was', () => {
    // The ONE place the art is tied to the hitbox, so the coupling is stated rather than
    // smeared across every dimension assertion.
    expect(BOSS_WIDTH).toBe(3)
    expect(BOSS_HEIGHT).toBe(3)

    const boss = spawnBoss()
    expect(boss.aabb.w).toBe(BOSS_WIDTH)
    expect(boss.aabb.h).toBe(BOSS_HEIGHT)
  })

  test('follows the hitbox in world units as the fight plays out', () => {
    const boss = spawnBoss()

    expect(boss.mesh.position.x).toBeCloseTo((SPAWN.x + boss.aabb.w / 2) * TILE_SIZE, 6)
    expect(boss.mesh.position.y).toBeCloseTo((SPAWN.y + boss.aabb.h / 2) * TILE_SIZE, 6)

    for (let i = 0; i < 300; i += 1) boss.step(DT, ARENA)

    expect(boss.mesh.position.x).toBeCloseTo((boss.aabb.x + boss.aabb.w / 2) * TILE_SIZE, 6)
    expect(boss.mesh.position.y).toBeCloseTo((boss.aabb.y + boss.aabb.h / 2) * TILE_SIZE, 6)
    expect(boss.mesh.position.z).toBe(0)
  })

  test('is painted in a royal palette, not arbitrary colours', () => {
    const [points, band, jewel, head, collar, robe, hem] = kingParts()

    // Asserted as channel ratios, not hex: THREE.Color runs a hex through the working
    // colour space, so the stored values are not the literals in standin.ts.
    for (const gold of [band, points]) {
      expect(gold.color.r).toBeGreaterThan(gold.color.g)
      expect(gold.color.g).toBeGreaterThan(gold.color.b)
    }
    // The points catch the light the band does not, which is what separates them from it.
    expect(points.color.r).toBeGreaterThan(band.color.r)
    expect(points.color.g).toBeGreaterThan(band.color.g)

    // Robe and hem are purple: blue-dominant with red over green.
    for (const purple of [robe, hem]) {
      expect(purple.color.b).toBeGreaterThan(purple.color.r)
      expect(purple.color.r).toBeGreaterThan(purple.color.g)
    }
    // The hem is the shaded underside of the same robe, so it must be darker but still purple.
    expect(hem.color.r).toBeLessThan(robe.color.r)
    expect(hem.color.b).toBeLessThan(robe.color.b)

    // Ermine collar: bright and near-neutral, the one light band in the silhouette.
    expect(Math.min(collar.color.r, collar.color.g, collar.color.b)).toBeGreaterThan(0.5)
    expect(collar.color.r - collar.color.b).toBeLessThan(0.25)

    // Green head, so the boss is nobody's palette but his own — the player is yellow-headed.
    expect(head.color.g).toBeGreaterThan(head.color.r)
    expect(head.color.g).toBeGreaterThan(head.color.b)

    // Rose jewel: red-dominant, but blue over green so it cannot be mistaken for the gold.
    expect(jewel.color.r).toBeGreaterThan(jewel.color.b)
    expect(jewel.color.b).toBeGreaterThan(jewel.color.g)
  })

  test('reads as a king: the crown overhangs the head and the robe flares out', () => {
    const [points, band, , head, , robe, hem] = kingParts()
    const halfY = (BOSS_MESH_HEIGHT / 2) * TILE_SIZE

    // Wide-over-narrow, twice. The band over the head is what makes the top say "crown"
    // rather than "block"; the hem over the robe is what makes the bottom say "robe".
    expect(band.halfWidth).toBeGreaterThan(head.halfWidth)
    expect(hem.halfWidth).toBeGreaterThan(robe.halfWidth)
    // The points are the top of the silhouette and the hem is the bottom of it.
    expect(points.maxY).toBeCloseTo(halfY, 3)
    expect(hem.minY).toBeCloseTo(-halfY, 3)
    // The crown sits on the head, not beside it.
    expect(band.minY).toBeGreaterThan(head.minY)
  })

  test('the crown has three separate points, not one gold slab', () => {
    const [points] = kingParts()

    // Three boxes means six distinct X edges. A solid slab would have exactly two.
    expect(points.edgesX).toHaveLength(6)
    for (let i = 0; i < points.edgesX.length; i += 2) {
      const left = points.edgesX[i]!
      const right = points.edgesX[i + 1]!
      const nextLeft = points.edgesX[i + 2]
      expect(right).toBeGreaterThan(left)
      // A real gap between the points, so they never merge into a band at any zoom.
      if (nextLeft !== undefined) expect(nextLeft).toBeGreaterThan(right)
    }
  })

  test('the jewel sits proud of the crown band', () => {
    const [, band, jewel] = kingParts()

    // The one part off the Z centre: it catches the light the flat front face cannot.
    expect(jewel.maxZ).toBeGreaterThan(band.maxZ)
  })

  test('overlaps at every join, so no seam can open', () => {
    const parts = kingParts()

    for (let i = 0; i < parts.length - 1; i += 1) {
      const upper = parts[i]!
      const lower = parts[i + 1]!
      expect(lower.maxY).toBeGreaterThan(upper.minY)
    }
  })

  test('flashes gold while telegraphing, then settles back', () => {
    const boss = spawnBoss()
    const idle = boss.mesh.material.color.clone()

    // Deliberately NOT white, unlike the player and the walker: Lambert multiplies
    // material.color by the vertex colour, and this tint is the telegraph tell, so white
    // would leave no headroom to flash upward.
    expect(idle.getHex()).not.toBe(0xffffff)
    expect(Math.max(idle.r, idle.g, idle.b)).toBeLessThan(1)

    stepUntil(boss, (b) => b.telegraphing)
    const flash = boss.mesh.material.color.clone()

    expect(flash.getHex()).not.toBe(idle.getHex())
    // Brighter overall and warmer with it, so the wind-up reads without any VFX.
    expect(flash.r + flash.g + flash.b).toBeGreaterThan(idle.r + idle.g + idle.b)
    expect(flash.r).toBeGreaterThan(idle.r)
    expect(flash.g).toBeGreaterThan(idle.g)
    // Warmer, not just brighter — the old neutral gray flash cleared every bar above it.
    expect(flash.r - flash.b).toBeGreaterThan(idle.r - idle.b)

    stepUntil(boss, (b) => b.state === 'attack')
    expect(boss.mesh.material.color.getHex()).toBe(idle.getHex())
  })
})

describe('module surface', () => {
  test('exports exactly one boss class', () => {
    const classes = Object.entries(bossModule)
      .filter(([, value]) => typeof value === 'function' && /^[A-Z]/.test(value.name))
      .map(([name]) => name)

    expect(classes).toEqual(['BossStandin'])
  })

  test('standin.ts is the only file under src/entities/bosses', () => {
    const files = import.meta.glob('../src/entities/bosses/*.ts')

    expect(Object.keys(files).sort()).toEqual(['../src/entities/bosses/standin.ts'])
  })

  test('uses no randomness or wall-clock time', () => {
    expect(SOURCE).not.toMatch(/Math\.random/)
    expect(SOURCE).not.toMatch(/Date\.now/)
    expect(SOURCE).not.toMatch(/performance\.now/)
    expect(SOURCE).not.toMatch(/crypto\./)
  })

  test('imports nothing from the enemy or player modules', () => {
    const importSources = [...SOURCE.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '')

    expect(importSources.length).toBeGreaterThan(0)
    for (const source of importSources) {
      expect(source).not.toMatch(/walker/i)
      expect(source).not.toMatch(/player/i)
      expect(source).not.toMatch(/enemies/i)
    }
  })
})
