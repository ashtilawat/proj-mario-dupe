# T-054 Cave Backdrop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `createCaveBackdrop()` — a dark paper-cut cave silhouette layer parked on the background plane — as the underground counterpart to the sky backdrop, built and tested in isolation.

**Architecture:** A single new module, `src/render/cave-backdrop.ts`, mirroring `src/render/backdrop.ts` beat for beat: literal specs, shared geometries, `MeshLambertMaterial`, a fresh `THREE.Group` per call parked at a locally-duplicated `-20`. What makes it read as a cave rather than recoloured hills is that rock comes in from *both* sides — a mass hanging from above and a mass rising from below, with a band of void between them for the level to sit in — and five cone spikes rooted in that rock. One re-export line joins it to `src/render/index.ts`; nothing calls it. Wiring it behind a live underground level is T-055.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`), three.js ^0.180, vitest ^3 under jsdom.

**Spec:** the approved T-054 design, reproduced in full in [Design Reference](#design-reference) below (the brainstorm lives at `~/.claude/plans/brainstorming-you-are-implementing-calm-shell.md`, outside the repo, so the plan carries the spec itself).

## Global Constraints

- Branch `gfx/cave-backdrop`, in this worktree only. No `git worktree add`. No push, no merge, no Railway. Do not touch other checkouts under `/workspace/untitled-25d-platformer*`.
- Files that may be created: `src/render/cave-backdrop.ts`, `tests/cave-backdrop.test.ts`. File that may be modified: `src/render/index.ts` — **one added line, nothing else**.
- Hard no-touch: `src/render/backdrop.ts`, `src/main.ts`, `src/render/tile-art.ts`, `hud.ts` / `src/ui/`, `src/entities/`, `tests/backdrop.test.ts`, `tests/backdrop-wire.test.ts`.
- Do not reformat `index.ts`. Do not change `BG_Z`, `createRenderScene`, `createTileLayer`, `createCamera`, `createBackdrop`, or any existing function body.
- `cave-backdrop.ts` must NOT import from `./index.ts` — index re-exports it, so that would close a cycle. Depth comes from a local `const CAVE_BACKDROP_Z = -20`; the test asserts it equals the imported `BG_Z`.
- Do not import from `./tile-art.ts` either (out of scope). Any palette hex it needs is duplicated locally, with a comment saying why.
- `MeshLambertMaterial` only — never `MeshStandardMaterial` or `MeshPhysicalMaterial`.
- Group name `'cave-backdrop'` (never `'backdrop'`). Child `userData.kind` values are `'cave-wall'`, `'stalactite'`, `'stalagmite'` — never `'hill'` or `'cloud'`.
- No `Math.random`: every literal is written out, so the art comes out identical on every call and can be asserted.
- Visual only: no physics, no `userData.aabb`, no `update`, no animation, no wiring into `createRenderScene` or `main.ts`.

---

## Design Reference

Orthographic camera (`FRUSTUM_HEIGHT = 10`), so at `z = -20` frustum units are world units: y spans [-5, 5], x spans ±8.89 at 16:9. Every literal below is sized against that and overshoots the edges so a later parallax pass has slack.

**Rock masses** — six upper-hemisphere domes, `SphereGeometry(1, 12, 6, 0, 2π, 0, π/2)`. The `thetaLength` stop leaves a flat cut edge at local y = 0, so `position.y` is the base line and `scale.y` the reach. Floor row sits at base y = -6, ceiling row at base y = +6 with `rotation.z = Math.PI` (turned over; rotating rather than scaling by -1 keeps normals facing out for Lambert). Both bases are outside the frustum, so no dome ever shows its cut edge. The floor row tops out at y ≈ -1.4 and the ceiling row reaches down to y ≈ 1.4 — the corridor of void between them is the cave.

**Formations** — five `ConeGeometry(1, 1, 6)` spikes at local z = +0.5, in front of both rock rows (the depth slot clouds occupy in `backdrop.ts`). Three stalactites carry `rotation.z = Math.PI` (apex down); two stalagmites point up. Each is positioned so its base is buried inside the rock mass and its tip tapers into open void — the join never has to be drawn.

**Palette** — three local hexes, cool and dark:

| const | hex | channels | luma sum | role |
|---|---|---|---|---|
| `CAVE_FAR_COLOR` | `0x2e3757` | 46, 55, 87 | 188 | far rock row — lifted, reads as distance |
| `CAVE_NEAR_COLOR` | `0x212845` | 33, 40, 69 | 142 | near rock row, the darkest mass |
| `FORMATION_COLOR` | `0x3a4569` | 58, 69, 105 | 232 | spikes, so they read in front of the near rock |

> **Palette correction from the brainstorm.** The design first proposed `0x39456b / 0x232c49 / 0x4a5578` and claimed all three came out darker than both grass-hill hexes. That was wrong: `0x4a5578` sums to 279, above the near hill's `0x3f6b47` (241). The table above is the corrected palette — every hex now sums below 241, every green channel sits below both hill greens (127 and 107), every hex is blue-dominant (`b > g > r`), and every channel clears `UNDERGROUND_SKY_COLOR` (`0x0a0e1a` = 10, 14, 26) by at least +23 so the silhouettes do not sink into the void. Same intent, numbers that actually hold.

**Depth banding** — far walls at local z -0.6, near walls -0.3, formations +0.5, matching `backdrop.ts`, so overlapping opaque silhouettes depth-sort instead of z-fighting. World z stays within [-20.6, -19.5]: inside the [-40, -10] background band and well behind `GAMEPLAY_Z`.

**Cost** — 11 meshes, 2 geometries, 3 materials. No lights, no nested groups.

---

## File Structure

- **Create `src/render/cave-backdrop.ts`** — the whole layer: local depth constant, palette, two literal spec tables, two geometry factories, and the exported `createCaveBackdrop()`. Self-contained by design; its only import is `three`.
- **Create `tests/cave-backdrop.test.ts`** — everything asserted straight off the factory. Test helpers are duplicated locally from `tests/backdrop.test.ts`, which defines them locally too: house style here, and it keeps the ticket from touching shared files.
- **Modify `src/render/index.ts`** — one line added directly under line 6 (`export { createBackdrop } from './backdrop.ts'`). Nothing else in the file is read or written.

---

## Task 1: The cave backdrop module

**Files:**
- Create: `src/render/cave-backdrop.ts`
- Test: `tests/cave-backdrop.test.ts`

**Interfaces:**
- Consumes: `BG_Z`, `GAMEPLAY_Z`, `FRUSTUM_HEIGHT`, `createBackdrop` from `../src/render` (all already exported; the test imports them, the module does not).
- Produces: `export function createCaveBackdrop(): THREE.Group` in `src/render/cave-backdrop.ts`. Task 2 re-exports exactly this symbol.

- [ ] **Step 1: Write the failing test**

Create `tests/cave-backdrop.test.ts` with this exact content. Note the import of `createCaveBackdrop` — it comes straight from the module path in this task, because `index.ts` does not re-export it until Task 2.

```ts
/**
 * T-054 — the cave backdrop, in isolation.
 *
 * Nothing hangs this on screen yet (that is T-055), so everything here is asserted straight off
 * the factory. The sky backdrop it sits beside is covered by tests/backdrop.test.ts and is only
 * touched here to prove the two are different things.
 */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { BG_Z, FRUSTUM_HEIGHT, GAMEPLAY_Z, createBackdrop } from '../src/render'
import { createCaveBackdrop } from '../src/render/cave-backdrop.ts'

/**
 * Raw 0-255 channels straight off the hex, the way tests/backdrop.test.ts reads colours.
 * Going through the hex sidesteps three's sRGB-to-linear conversion of Color.r/g/b, so the
 * numbers asserted here are the numbers written in the source.
 */
function channels(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

function luma(hex: number): number {
  const { r, g, b } = channels(hex)
  return r + g + b
}

/**
 * The hexes backdrop.ts paints its hills in and the underground void hex from tile-art.ts,
 * copied rather than imported: the first two are module-private there, and this ticket does not
 * reach into tile-art.ts. They are here as the two things the cave palette is measured against —
 * darker and less green than the hills, but clear of the void.
 */
const HILL_HEXES = [0x4a7f6d, 0x3f6b47] as const
const VOID_HEX = 0x0a0e1a

/** Turned-over meshes carry this on rotation.z: PI about Z hangs a dome and points a cone down. */
const UPSIDE_DOWN = Math.PI

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function isPbrMaterial(material: THREE.Material): boolean {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  )
}

function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  return group.children.filter(isMesh)
}

function childrenOfKind(group: THREE.Object3D, kind: string): THREE.Mesh[] {
  return meshesOf(group).filter((mesh) => mesh.userData['kind'] === kind)
}

/** Doubles as the "it is a SphereGeometry" assertion, and dodges a cast: Mesh.geometry is
 *  typed as BufferGeometry, which has no `parameters`. */
function sphereParams(mesh: THREE.Mesh): THREE.SphereGeometry['parameters'] {
  const { geometry } = mesh
  if (!(geometry instanceof THREE.SphereGeometry)) {
    throw new Error(`expected SphereGeometry on "${mesh.name}", got ${geometry.type}`)
  }
  return geometry.parameters
}

function coneParams(mesh: THREE.Mesh): THREE.ConeGeometry['parameters'] {
  const { geometry } = mesh
  if (!(geometry instanceof THREE.ConeGeometry)) {
    throw new Error(`expected ConeGeometry on "${mesh.name}", got ${geometry.type}`)
  }
  return geometry.parameters
}

function colorOf(mesh: THREE.Mesh): number {
  const [material] = materialsOf(mesh)
  if (!(material instanceof THREE.MeshLambertMaterial)) {
    throw new Error(`expected a MeshLambertMaterial on "${mesh.name}"`)
  }
  return material.color.getHex()
}

function worldZOf(mesh: THREE.Object3D): number {
  return mesh.getWorldPosition(new THREE.Vector3()).z
}

/** A dome's reach: its base line plus the height it was scaled to. Signed, so a ceiling dome
 *  (turned over) reports how far down it hangs. */
function domeReach(mesh: THREE.Mesh): number {
  return mesh.position.y + (mesh.rotation.z === 0 ? mesh.scale.y : -mesh.scale.y)
}

describe('createCaveBackdrop', () => {
  test('is a Group parked on the background plane', () => {
    const cave = createCaveBackdrop()

    expect(cave).toBeInstanceOf(THREE.Object3D)
    expect(cave).toBeInstanceOf(THREE.Group)
    expect(cave.name).toBe('cave-backdrop')
    // 'backdrop' belongs to createBackdrop and to the live wiring that looks it up by name.
    expect(cave.name).not.toBe('backdrop')

    // CAVE_BACKDROP_Z is duplicated inside cave-backdrop.ts rather than imported, to avoid a
    // cycle with the re-export. This is the assertion that keeps the duplicate honest.
    expect(cave.position.z).toBe(BG_Z)
    expect(cave.position.z).toBe(-20)
    expect(cave.position.z).toBeLessThan(GAMEPLAY_Z)
  })

  test('returns a fresh group per call, so two scenes never share one', () => {
    const first = createCaveBackdrop()
    const second = createCaveBackdrop()

    expect(first).not.toBe(second)
    expect(first.children).toHaveLength(second.children.length)
  })

  test('is its own factory, not an alias of the sky backdrop', () => {
    expect(createCaveBackdrop).not.toBe(createBackdrop)

    const cave = createCaveBackdrop()
    expect(cave.name).not.toBe(createBackdrop().name)
    // No hills, no clouds: those kinds belong to the sky layer.
    expect(childrenOfKind(cave, 'hill')).toHaveLength(0)
    expect(childrenOfKind(cave, 'cloud')).toHaveLength(0)
    for (const mesh of meshesOf(cave)) {
      expect(['cave-wall', 'stalactite', 'stalagmite']).toContain(mesh.userData['kind'])
    }
  })
})

describe('cave walls', () => {
  test('are domes closing in from the ceiling and from the floor', () => {
    const walls = childrenOfKind(createCaveBackdrop(), 'cave-wall')
    const floor = walls.filter((wall) => wall.rotation.z === 0)
    const ceiling = walls.filter((wall) => wall.rotation.z !== 0)
    const halfHeight = FRUSTUM_HEIGHT / 2

    expect(floor.length).toBeGreaterThanOrEqual(2)
    expect(ceiling.length).toBeGreaterThanOrEqual(2)

    for (const wall of walls) {
      const params = sphereParams(wall)
      // thetaLength stops the sweep at the equator: a dome with a flat cut edge, not a ball.
      // That is what lets position.y be the base line and scale.y the reach.
      expect(params.thetaLength).toBeCloseTo(Math.PI / 2, 5)
      // Cheap. A background silhouette does not need a smooth limb.
      expect(params.widthSegments).toBeLessThanOrEqual(16)
    }

    // Bases sit outside the frustum, so no dome ever reveals its flat cut edge.
    for (const wall of floor) {
      expect(wall.position.y).toBeLessThanOrEqual(-halfHeight)
    }
    for (const wall of ceiling) {
      // PI about Z turns the dome over and leaves depth alone.
      expect(wall.rotation.z).toBeCloseTo(UPSIDE_DOWN, 5)
      expect(wall.position.y).toBeGreaterThanOrEqual(halfHeight)
    }
  })

  test('leave a corridor of void across the middle of the frame', () => {
    const walls = childrenOfKind(createCaveBackdrop(), 'cave-wall')
    const floorTop = Math.max(
      ...walls.filter((wall) => wall.rotation.z === 0).map(domeReach),
    )
    const ceilingUnderside = Math.min(
      ...walls.filter((wall) => wall.rotation.z !== 0).map(domeReach),
    )

    // Rock from both sides, never meeting: this is what makes it a cave and not a hill row.
    expect(floorTop).toBeLessThan(0)
    expect(ceilingUnderside).toBeGreaterThan(0)
    expect(ceilingUnderside).toBeGreaterThan(floorTop)
  })

  test('overfill the frustum, so no void shows past either edge', () => {
    const walls = childrenOfKind(createCaveBackdrop(), 'cave-wall')
    // Orthographic: no perspective shrink at BG_Z, so frustum units are world units.
    const halfWidth = (FRUSTUM_HEIGHT / 2) * (16 / 9)

    for (const row of [
      walls.filter((wall) => wall.rotation.z === 0),
      walls.filter((wall) => wall.rotation.z !== 0),
    ]) {
      const left = Math.min(...row.map((wall) => wall.position.x - wall.scale.x))
      const right = Math.max(...row.map((wall) => wall.position.x + wall.scale.x))
      expect(left).toBeLessThan(-halfWidth)
      expect(right).toBeGreaterThan(halfWidth)
    }
  })

  test('form two rows at distinct depths, all behind gameplay', () => {
    const cave = createCaveBackdrop()
    cave.updateMatrixWorld(true)
    const walls = childrenOfKind(cave, 'cave-wall')

    // Two rows, so overlapping opaque domes depth-sort instead of z-fighting.
    const depths = new Set(walls.map((wall) => wall.position.z))
    expect(depths.size).toBeGreaterThanOrEqual(2)

    for (const wall of walls) {
      for (const material of materialsOf(wall)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(wall)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('cave formations', () => {
  test('hang from the ceiling and rise from the floor, rooted in rock', () => {
    const cave = createCaveBackdrop()
    const stalactites = childrenOfKind(cave, 'stalactite')
    const stalagmites = childrenOfKind(cave, 'stalagmite')
    // Quarter of the frustum: past this from the middle you are inside the rock mass.
    const insideRock = FRUSTUM_HEIGHT / 4
    const offScreen = FRUSTUM_HEIGHT / 2

    expect(stalactites.length).toBeGreaterThanOrEqual(1)
    expect(stalagmites.length).toBeGreaterThanOrEqual(1)

    for (const spike of [...stalactites, ...stalagmites]) {
      const params = coneParams(spike)
      // Cheap facets, not a turned column.
      expect(params.radialSegments).toBeLessThanOrEqual(8)
    }

    for (const spike of stalactites) {
      // Turned over, so the apex points down into the void.
      expect(spike.rotation.z).toBeCloseTo(UPSIDE_DOWN, 5)
      const root = spike.position.y + spike.scale.y / 2
      const tip = spike.position.y - spike.scale.y / 2
      expect(root).toBeGreaterThan(insideRock)
      expect(tip).toBeLessThan(insideRock)
      expect(tip).toBeGreaterThan(-offScreen)
    }

    for (const spike of stalagmites) {
      expect(spike.rotation.z).toBe(0)
      const root = spike.position.y - spike.scale.y / 2
      const tip = spike.position.y + spike.scale.y / 2
      expect(root).toBeLessThan(-insideRock)
      expect(tip).toBeGreaterThan(-insideRock)
      expect(tip).toBeLessThan(offScreen)
    }
  })

  test('ride in front of both rock rows, and stay behind gameplay', () => {
    const cave = createCaveBackdrop()
    cave.updateMatrixWorld(true)
    const frontmostWallZ = Math.max(
      ...childrenOfKind(cave, 'cave-wall').map((wall) => wall.position.z),
    )
    const spikes = [...childrenOfKind(cave, 'stalactite'), ...childrenOfKind(cave, 'stalagmite')]

    for (const spike of spikes) {
      // In front of every dome, so an overlap depth-sorts instead of z-fighting.
      expect(spike.position.z).toBeGreaterThan(frontmostWallZ)

      for (const material of materialsOf(spike)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(spike)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('cave palette', () => {
  test('is cool dark rock, never the grass-hill greens', () => {
    const dullestHill = Math.min(...HILL_HEXES.map(luma))
    const palestHillGreen = Math.min(...HILL_HEXES.map((hex) => channels(hex).g))

    for (const mesh of meshesOf(createCaveBackdrop())) {
      const { r, g, b } = channels(colorOf(mesh))

      // Blue-dominant slate. Green never leads, so this can never drift back to the hills.
      expect(b).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(r)
      // Darker than either hill row, and with less green in it than either.
      expect(luma(colorOf(mesh))).toBeLessThan(dullestHill)
      expect(g).toBeLessThan(palestHillGreen)
    }
  })

  test('clears the underground void, so the silhouettes still read against it', () => {
    const voidChannels = channels(VOID_HEX)

    for (const mesh of meshesOf(createCaveBackdrop())) {
      const { r, g, b } = channels(colorOf(mesh))

      // Near-black on near-black is not a silhouette. Every channel stands off the void.
      expect(r).toBeGreaterThanOrEqual(voidChannels.r + 20)
      expect(g).toBeGreaterThanOrEqual(voidChannels.g + 20)
      expect(b).toBeGreaterThanOrEqual(voidChannels.b + 20)
    }
  })
})

describe('cave backdrop cost', () => {
  test('is a handful of meshes over shared geometries and materials', () => {
    const cave = createCaveBackdrop()
    const meshes = meshesOf(cave)

    // Nothing but meshes hangs off the group: no stray lights, no nested groups.
    expect(meshes).toHaveLength(cave.children.length)
    expect(meshes.length).toBeLessThanOrEqual(12)

    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))

    expect(geometries.size).toBeLessThanOrEqual(2)
    expect(materials.size).toBeLessThanOrEqual(3)
  })

  test('carries no physics: this layer is visual only', () => {
    const cave = createCaveBackdrop()

    expect('update' in cave).toBe(false)
    expect(cave.userData['aabb']).toBeUndefined()

    for (const child of cave.children) {
      expect(child.userData['aabb']).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cave-backdrop.test.ts`

Expected: FAIL — the whole file errors before any test runs, with a resolution failure on `../src/render/cave-backdrop.ts` ("Failed to resolve import" / "Cannot find module"). That is the red: the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/render/cave-backdrop.ts` with this exact content:

```ts
import * as THREE from 'three'

/**
 * Cave backdrop: rock closing in from the ceiling and from the floor, parked on the background
 * plane. The underground counterpart to the sky hills in ./backdrop.ts, in the same paper-cut
 * language — stretched hemispheres, flat literals, cheap Lambert.
 *
 * Visual only — no physics body, no AABB, no per-frame update.
 *
 * NOT WIRED TO ANYTHING ON SCREEN yet. Nothing calls this: `createRenderScene` still paints its
 * background with a flat instanced tile layer, and main.ts never asks for it. Hanging it behind
 * an underground level is a later ticket.
 *
 * The camera is orthographic (see FRUSTUM_HEIGHT in ./index.ts), so nothing here shrinks with
 * distance — geometry at CAVE_BACKDROP_Z draws at true world size, and frustum units are world
 * units. Everything below is sized against the frustum directly: y spans [-5, 5], x spans
 * ±8.9 at 16:9.
 *
 * What makes this a cave rather than recoloured hills is that the rock comes in from both
 * sides. A mass hangs from above, a mass rises from below, and the band of void left between
 * them is the corridor the level sits in.
 */

/**
 * Depth of the layer. Mirrors `BG_Z` in ./index.ts, deliberately duplicated rather than
 * imported: index.ts re-exports this module, so importing back from it would close a cycle.
 * `tests/cave-backdrop.test.ts` asserts the two stay equal.
 */
const CAVE_BACKDROP_Z = -20

/** Lifted slate for the far rock row. Cave air is not clear air; the far mass catches enough
 *  bounced light to separate from the near one. */
const CAVE_FAR_COLOR = 0x2e3757

/** Deeper indigo for the near row, the darkest mass in the layer. */
const CAVE_NEAR_COLOR = 0x212845

/** Stalactites and stalagmites, a shade up from the rock so the spikes keep their edge against
 *  it instead of dissolving into the mass they grow out of. */
const FORMATION_COLOR = 0x3a4569

/**
 * All three are blue-dominant and darker than the grass hills in ./backdrop.ts, with less green
 * in them than either hill tone — this layer must never drift back toward that palette. They
 * also each stand at least 20 per channel off UNDERGROUND_SKY_COLOR (0x0a0e1a in ./tile-art.ts),
 * the void they are read against: near-black on near-black is not a silhouette. Both of those
 * modules keep their own copies of their hexes; this one imports no palette, by scope.
 */

/**
 * Local Z offsets: small enough to keep every mesh inside the background band, large enough to
 * give overlapping opaque silhouettes a real depth order instead of z-fighting.
 */
const FAR_WALL_Z = -0.6
const NEAR_WALL_Z = -0.3

/** Formations ride in front of both rock rows. */
const FORMATION_Z = 0.5

/** Dome base lines, both outside the frustum (y in [-5, 5]) so no mass ever shows the flat cut
 *  edge left by the hemisphere sweep. */
const FLOOR_BASE_Y = -6
const CEILING_BASE_Y = 6

/** Flattening applied to every silhouette's depth. The layer is read head-on, so thickness is
 *  wasted geometry — it needs just enough not to look like cut cardboard. */
const SILHOUETTE_DEPTH = 0.35

/**
 * Turning a mesh over. PI about Z maps (x, y) to (-x, -y) and leaves depth alone, so a dome
 * hangs and a cone points down. Rotating rather than scaling by -1 keeps the normals facing
 * outward, which a Lambert surface needs to catch the light at all.
 */
const UPSIDE_DOWN = Math.PI

interface WallSpec {
  x: number
  halfWidth: number
  height: number
  far: boolean
  ceiling: boolean
}

/**
 * Two rock masses. The floor row tops out around y = -1.4 and the ceiling row reaches down to
 * about y = 1.4, leaving the corridor of void between them. Spans overlap horizontally so
 * neither wall of rock breaks, and reach past x = ±8.9 (the 16:9 frustum edge) so a later
 * parallax pass can slide the layer without exposing an edge.
 *
 * Literal, never generated: Math.random has no place here, for the same reason it has none in
 * backdrop.ts or tile-art.ts — the art has to come out identical on every call so it can be
 * asserted.
 */
const WALLS: readonly WallSpec[] = [
  { x: -7.5, halfWidth: 6, height: 4.4, far: true, ceiling: false },
  { x: 2, halfWidth: 6.5, height: 4, far: true, ceiling: false },
  { x: 9.5, halfWidth: 6, height: 4.6, far: false, ceiling: false },
  { x: -8, halfWidth: 6.5, height: 4.2, far: true, ceiling: true },
  { x: 1, halfWidth: 6, height: 4.6, far: true, ceiling: true },
  { x: 9, halfWidth: 6.5, height: 4, far: false, ceiling: true },
]

/**
 * Upper hemisphere: `thetaLength = PI / 2` stops the sweep at the equator, leaving a flat edge
 * at local y = 0. That makes position.y the mass's base line and scale.y its reach, and costs
 * half the triangles of a full sphere. A ceiling mass is the same geometry turned over.
 */
function createWallGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
}

interface FormationSpec {
  x: number
  y: number
  halfWidth: number
  height: number
  ceiling: boolean
}

/**
 * Five spikes, unevenly spaced and unevenly sized — an even rhythm would read as a fence. Each
 * is rooted well inside the mass it grows from and tapers into open void, so the join never has
 * to be drawn. `y` is the centre of the cone, not its tip.
 */
const FORMATIONS: readonly FormationSpec[] = [
  { x: -5.2, y: 2.4, halfWidth: 0.55, height: 2.6, ceiling: true },
  { x: 0.6, y: 1.9, halfWidth: 0.42, height: 2.2, ceiling: true },
  { x: 6.4, y: 2.6, halfWidth: 0.6, height: 3, ceiling: true },
  { x: -2.8, y: -2.4, halfWidth: 0.6, height: 2.6, ceiling: false },
  { x: 5, y: -1.9, halfWidth: 0.5, height: 2, ceiling: false },
]

/** Unit cone, apex up at local y = 0.5, so position.y is the spike's centre and scale.y its
 *  length. Six radial segments: a silhouette this small has no need of a round limb, and the
 *  flat facets suit the cut-paper look. */
function createFormationGeometry(): THREE.ConeGeometry {
  return new THREE.ConeGeometry(1, 1, 6)
}

/** Cave rock and its formations for the background plane. A fresh group every call — two scenes
 *  must never share one object. */
export function createCaveBackdrop(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'cave-backdrop'
  group.position.z = CAVE_BACKDROP_Z

  const wallGeometry = createWallGeometry()
  const farWallMaterial = new THREE.MeshLambertMaterial({ color: CAVE_FAR_COLOR })
  const nearWallMaterial = new THREE.MeshLambertMaterial({ color: CAVE_NEAR_COLOR })

  for (const wall of WALLS) {
    const mesh = new THREE.Mesh(wallGeometry, wall.far ? farWallMaterial : nearWallMaterial)
    mesh.name = 'cave-wall'
    mesh.userData['kind'] = 'cave-wall'
    mesh.position.set(
      wall.x,
      wall.ceiling ? CEILING_BASE_Y : FLOOR_BASE_Y,
      wall.far ? FAR_WALL_Z : NEAR_WALL_Z,
    )
    mesh.scale.set(wall.halfWidth, wall.height, SILHOUETTE_DEPTH)
    if (wall.ceiling) {
      mesh.rotation.z = UPSIDE_DOWN
    }
    group.add(mesh)
  }

  const formationGeometry = createFormationGeometry()
  const formationMaterial = new THREE.MeshLambertMaterial({ color: FORMATION_COLOR })

  for (const formation of FORMATIONS) {
    const mesh = new THREE.Mesh(formationGeometry, formationMaterial)
    mesh.name = formation.ceiling ? 'stalactite' : 'stalagmite'
    mesh.userData['kind'] = mesh.name
    mesh.position.set(formation.x, formation.y, FORMATION_Z)
    mesh.scale.set(formation.halfWidth, formation.height, SILHOUETTE_DEPTH)
    if (formation.ceiling) {
      mesh.rotation.z = UPSIDE_DOWN
    }
    group.add(mesh)
  }

  return group
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cave-backdrop.test.ts`
Expected: PASS — 13 tests (3 factory, 4 walls, 2 formations, 2 palette, 2 cost).

If a geometry assertion fails, do not loosen the test: the specs above are chosen so every one of them holds (floor tops at -1.6 / -2.0 / -1.4, ceiling undersides at 1.8 / 1.4 / 2.0, spans -14.5…15.5 on both rows, stalactite tips at 1.1 / 0.8 / 1.1, stalagmite tips at -1.1 / -0.9). A failure means a literal was mistyped.

- [ ] **Step 5: Check the whole suite and the types**

Run: `npm test`
Expected: PASS, with `tests/backdrop.test.ts` and `tests/backdrop-wire.test.ts` untouched and green.

Run: `npm run typecheck`
Expected: clean. Watch for `noUnusedLocals` — every helper in the test file is used, so an unused-symbol error means something was dropped in transcription.

- [ ] **Step 6: Commit**

```bash
git add src/render/cave-backdrop.ts tests/cave-backdrop.test.ts
git -c user.name="Ash Tilawat" -c user.email="ashtilawat23@gmail.com" \
  commit -m "T-054: the cave is rock from both sides, not hills in blue"
```

(No git identity is configured in this environment, hence the per-command `-c` flags.)

---

## Task 2: Reach it from src/render

**Files:**
- Modify: `src/render/index.ts:6` — add one line directly below it
- Test: `tests/cave-backdrop.test.ts` (add one describe block; do not alter the blocks from Task 1)

**Interfaces:**
- Consumes: `createCaveBackdrop` from Task 1.
- Produces: `createCaveBackdrop` re-exported from `src/render`, so T-055 can import it beside `createBackdrop`.

- [ ] **Step 1: Write the failing test**

In `tests/cave-backdrop.test.ts`, extend the existing `../src/render` import with an alias:

```ts
import {
  BG_Z,
  FRUSTUM_HEIGHT,
  GAMEPLAY_Z,
  createBackdrop,
  createCaveBackdrop as createCaveBackdropFromIndex,
} from '../src/render'
```

and append this describe block at the end of the file:

```ts
describe('the cave backdrop, as src/render publishes it', () => {
  test('is re-exported beside createBackdrop, and is not that function', () => {
    // T-055 imports it from '../src/render', the way every other render factory is reached.
    expect(typeof createCaveBackdropFromIndex).toBe('function')
    expect(createCaveBackdropFromIndex).toBe(createCaveBackdrop)
    expect(createCaveBackdropFromIndex).not.toBe(createBackdrop)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cave-backdrop.test.ts`

Expected: FAIL. Vite resolves `../src/render` and finds no such named export, so this is either a link-time `SyntaxError` ("does not provide an export named 'createCaveBackdrop'") that fails the file, or `typeof undefined` failing the first assertion. Either is the red.

- [ ] **Step 3: Add the re-export**

In `src/render/index.ts`, directly below line 6, add exactly one line:

```ts
export { createBackdrop } from './backdrop.ts'
export { createCaveBackdrop } from './cave-backdrop.ts'
```

(The first line above is the existing line 6, shown only for placement. Add the second one and change nothing else — no reformatting, no reordering, no touching `createRenderScene`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cave-backdrop.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Verify the blast radius**

Run: `npm test` — full suite green.
Run: `npm run typecheck` — clean.
Run: `git diff --stat origin/main` — exactly three paths, and the `index.ts` change is `1 insertion(+)`, 0 deletions.
Run: `git diff origin/main -- src/render/index.ts` — confirm with your own eyes that the only change is the added export line.

- [ ] **Step 6: Commit**

```bash
git add src/render/index.ts tests/cave-backdrop.test.ts
git -c user.name="Ash Tilawat" -c user.email="ashtilawat23@gmail.com" \
  commit -m "T-054: hand the cave backdrop out of src/render"
```

Stop here. No push, no merge, no Railway — and no wiring into `createRenderScene` or `main.ts`, which is T-055.

---

## Verification

End to end, after both tasks:

1. `npm test` — the full suite, including `tests/cave-backdrop.test.ts` (14 tests) and the two untouched backdrop suites.
2. `npm run typecheck` — strict TS clean.
3. `git diff --stat origin/main` — three paths: two new files, one line added to `index.ts`.
4. `git status` — still on `gfx/cave-backdrop`, nothing unexpected staged, no other worktree touched.

If npm is denied by the current permission mode, re-probe before reporting anything as unverified: denials here are mode-scoped, not permanent.

There is nothing to see in the running app this ticket — by design, `createCaveBackdrop` reaches no screen until T-055 hangs it behind an underground level. The tests are the whole verification surface.
