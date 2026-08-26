/**
 * T-057 — the pennant waves like paper cloth.
 *
 * The flag shipped in T-039 as a static triangle. The wave has to be driven from the
 * banner's own `onBeforeRender`, because main.ts never calls `Flag.step` — the run loop
 * knows the flag only as a hitbox. That makes the animation invisible to every test that
 * does not render, which is all of them: jsdom ships no WebGL, so three.js never invokes
 * the hook. These tests therefore call it by hand, with `performance.now` pinned, and
 * assert on the geometry it writes.
 *
 * The rest of the flag is pinned by tests/flag-art.test.ts and must survive unchanged:
 * the AABB is still one tile, the pole still stands where it stood, and the banner still
 * hangs off the pole's -X face. Nothing here imports main.ts.
 */
import { describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import {
  BANNER_DROP,
  BANNER_HEIGHT,
  BANNER_WAVE_AMPLITUDE,
  BANNER_WIDTH,
  FLAG_HEIGHT,
  FLAG_WIDTH,
  POLE_HEIGHT,
  POLE_WIDTH,
  createFlag,
} from '../src/entities/goal/flag.ts'
import type { Flag } from '../src/entities/goal/flag.ts'
import { TILE_SIZE } from '../src/physics/index.ts'

/** three.js calls this every rendered frame; none of the six arguments are read. */
function drawFrame(flag: Flag): void {
  flag.banner.onBeforeRender(
    null as unknown as THREE.WebGLRenderer,
    null as unknown as THREE.Scene,
    null as unknown as THREE.Camera,
    flag.banner.geometry,
    flag.banner.material,
    null as unknown as THREE.Group,
  )
}

/** Pins the clock the wave reads, so a "frame" is a value we choose rather than a race. */
function atTime(ms: number): void {
  vi.spyOn(performance, 'now').mockReturnValue(ms)
}

function positions(flag: Flag): THREE.BufferAttribute {
  return flag.banner.geometry.getAttribute('position') as THREE.BufferAttribute
}

/** The free tip: the vertex furthest out along -X, where the wave is strongest. */
function tipIndex(flag: Flag): number {
  const pos = positions(flag)
  let tip = 0
  for (let i = 1; i < pos.count; i += 1) if (pos.getX(i) < pos.getX(tip)) tip = i
  return tip
}

/** Every vertex sitting on the pole edge, where the pennant is nailed down. */
function poleEdgeIndices(flag: Flag): number[] {
  const pos = positions(flag)
  const found: number[] = []
  for (let i = 0; i < pos.count; i += 1) if (pos.getX(i) === 0) found.push(i)
  return found
}

describe('the pennant geometry', () => {
  test('still holds a pole and a banner on a one-tile hitbox', () => {
    const flag = createFlag({ x: 22, y: 1 })

    expect(flag.aabb).toEqual({ x: 22, y: 1, w: FLAG_WIDTH, h: FLAG_HEIGHT })
    expect(flag.mesh.children).toEqual([flag.pole, flag.banner])
  })

  test('leaves the pole standing where it stood, unturned', () => {
    const flag = createFlag({ x: 22, y: 1 })
    const before = flag.pole.position.clone()

    atTime(0)
    drawFrame(flag)
    atTime(900)
    drawFrame(flag)

    // The wave is cloth, not a windmill: whatever the banner does, the mast is rigid.
    expect(flag.pole.position).toEqual(before)
    expect(flag.pole.rotation.x).toBe(0)
    expect(flag.pole.rotation.y).toBe(0)
    expect(flag.pole.rotation.z).toBe(0)
  })

  test('tessellates the triangle so the cloth has somewhere to bend', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const pos = positions(flag)

    // A three-vertex triangle can only tilt as a rigid plane. A ripple needs spans.
    expect(pos.count).toBeGreaterThan(3)
    // Still the same pennant: hung from the pole edge at x=0, tapering out over -X.
    expect(poleEdgeIndices(flag).length).toBeGreaterThan(0)
    expect(tipIndex(flag)).not.toBe(-1)
  })

  test('keeps the shipped pennant outline', () => {
    const flag = createFlag({ x: 0, y: 0 })
    flag.banner.geometry.computeBoundingBox()
    const box = flag.banner.geometry.boundingBox!

    expect(box.max.x).toBeCloseTo(0, 5)
    expect(box.min.x).toBeCloseTo(-BANNER_WIDTH * TILE_SIZE, 5)
    expect(box.max.y).toBeCloseTo(0, 5)
    expect(box.min.y).toBeCloseTo(-BANNER_HEIGHT * TILE_SIZE, 5)
  })

  test('hangs flat until something renders it', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const pos = positions(flag)

    // Tests never render, so this rest pose is what the whole suite sees — including the
    // outline assertions above and every geometry check in tests/flag-art.test.ts.
    for (let i = 0; i < pos.count; i += 1) expect(Math.abs(pos.getZ(i))).toBe(0)
  })
})

describe('the pennant wave', () => {
  test('drives itself from the banner, not from a step main.ts never calls', () => {
    const flag = createFlag({ x: 0, y: 0 })

    expect(typeof flag.banner.onBeforeRender).toBe('function')
    // Object3D ships a no-op in the prototype; the flag has to bring its own.
    expect(flag.banner.onBeforeRender).not.toBe(THREE.Object3D.prototype.onBeforeRender)
    expect(Object.hasOwn(flag.banner, 'onBeforeRender')).toBe(true)
  })

  test('moves the free tip between two frames', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const tip = tipIndex(flag)

    atTime(0)
    drawFrame(flag)
    const first = positions(flag).getZ(tip)
    atTime(260)
    drawFrame(flag)
    const second = positions(flag).getZ(tip)

    expect(second).not.toBeCloseTo(first, 6)
  })

  test('nails the pole edge down however hard the tip flaps', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const edge = poleEdgeIndices(flag)
    expect(edge.length).toBeGreaterThan(0)

    for (const ms of [0, 120, 260, 700, 1830]) {
      atTime(ms)
      drawFrame(flag)
      // A pennant tears off its pole if the attached edge moves. It never does.
      for (const i of edge) expect(Math.abs(positions(flag).getZ(i))).toBe(0)
    }
  })

  test('flaps harder the further out the cloth is', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const pos = positions(flag)

    // Sampled across a full period so no single frame's sine phase can fake the falloff.
    const reach = new Map<number, number>()
    for (let ms = 0; ms <= 2000; ms += 25) {
      atTime(ms)
      drawFrame(flag)
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i)
        reach.set(x, Math.max(reach.get(x) ?? 0, Math.abs(pos.getZ(i))))
      }
    }

    const byX = [...reach.entries()].sort((a, b) => b[0] - a[0])
    for (let i = 1; i < byX.length; i += 1) {
      // Monotone from the nailed edge out to the tip: no node in the middle of the cloth.
      expect(byX[i]![1]).toBeGreaterThan(byX[i - 1]![1] - 1e-9)
    }
    expect(byX.at(-1)![1]).toBeGreaterThan(byX[0]![1])
  })

  test('stays a small ripple, not a flag that leaves its tile', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const pos = positions(flag)

    for (let ms = 0; ms <= 2000; ms += 25) {
      atTime(ms)
      drawFrame(flag)
      for (let i = 0; i < pos.count; i += 1) {
        expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(BANNER_WAVE_AMPLITUDE * TILE_SIZE)
      }
    }
    // Paper cloth, not a windsock: the ripple stays a fraction of the pennant's own drop.
    expect(BANNER_WAVE_AMPLITUDE).toBeLessThan(BANNER_HEIGHT / 4)
    expect(BANNER_WAVE_AMPLITUDE).toBeGreaterThan(0)
  })

  test('never displaces X or Y, so the pennant stays on its pole', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const pos = positions(flag)
    const flat: number[] = []
    for (let i = 0; i < pos.count; i += 1) flat.push(pos.getX(i), pos.getY(i))

    for (const ms of [0, 310, 940]) {
      atTime(ms)
      drawFrame(flag)
    }

    const after: number[] = []
    for (let i = 0; i < pos.count; i += 1) after.push(pos.getX(i), pos.getY(i))
    // The wave reads from a rest copy, so a thousand frames cannot drift the outline.
    expect(after).toEqual(flat)
    expect(flag.banner.position.x).toBeCloseTo(
      flag.pole.position.x - (POLE_WIDTH * TILE_SIZE) / 2,
      5,
    )
    expect(flag.banner.position.y).toBeCloseTo((POLE_HEIGHT - BANNER_DROP) * TILE_SIZE, 5)
  })

  test('poses from the clock alone, so a repeated frame repeats itself', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const tip = tipIndex(flag)

    atTime(480)
    drawFrame(flag)
    const once = positions(flag).getZ(tip)
    drawFrame(flag)
    drawFrame(flag)

    // Displacement off the rest copy, not off the last frame: no integration, no runaway.
    expect(positions(flag).getZ(tip)).toBe(once)
  })

  test('tells the renderer the vertices moved', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const before = positions(flag).version

    atTime(75)
    drawFrame(flag)

    // `needsUpdate` is a setter with no getter, so `version` is the only witness. Without
    // it the GPU keeps drawing the rest pose forever, however far the CPU copy moves.
    expect(positions(flag).version).toBeGreaterThan(before)
  })

  test('relights the cloth, because a flat camera cannot see depth alone', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const tip = tipIndex(flag)
    const normals = () => flag.banner.geometry.getAttribute('normal') as THREE.BufferAttribute
    const before = normals().version

    atTime(0)
    drawFrame(flag)
    const first = Array.from(normals().array)
    let flattest = 1
    for (const ms of [0, 140, 300, 550, 820]) {
      atTime(ms)
      drawFrame(flag)
      flattest = Math.min(flattest, Math.abs(normals().getZ(tip)))
    }

    // The game's camera is orthographic and looks straight down -Z (src/render/index.ts):
    // a purely Z displacement moves no silhouette at all. The ripple is only visible as
    // light sliding across the paper, which means the normals have to move with it.
    expect(normals().version).toBeGreaterThan(before)
    expect(Array.from(normals().array)).not.toEqual(first)
    // And the cloth genuinely faces away from flat-on at the tip, so the directional light
    // has something to catch. A wave that only nudged the depth would leave this at 1.
    expect(flattest).toBeLessThan(0.99)
    for (let i = 0; i < normals().count; i += 1) {
      // A degenerate triangle would normalize a zero vector and poison the whole mesh.
      expect(Number.isNaN(normals().getX(i))).toBe(false)
      expect(Number.isNaN(normals().getY(i))).toBe(false)
      expect(Number.isNaN(normals().getZ(i))).toBe(false)
    }
  })

  test('frees both meshes on dispose, hook and all', () => {
    const flag = createFlag({ x: 0, y: 0 })
    const parent = new THREE.Group()
    parent.add(flag.mesh)
    const freed = [
      vi.spyOn(flag.pole.geometry, 'dispose'),
      vi.spyOn(flag.pole.material, 'dispose'),
      vi.spyOn(flag.banner.geometry, 'dispose'),
      vi.spyOn(flag.banner.material, 'dispose'),
    ]

    flag.dispose()

    for (const spy of freed) expect(spy).toHaveBeenCalledTimes(1)
    // The hook lives on the mesh, so unparenting is what stops it being called.
    expect(flag.mesh.parent).toBeNull()
  })
})
