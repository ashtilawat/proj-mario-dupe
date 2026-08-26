# T-041 Sky Hills Backdrop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `createBackdrop()` — a visual-only `THREE.Group` of hill silhouettes and clouds parked on the background plane at `z = -20` — as a new self-contained module, re-exported from `src/render`.

**Architecture:** One new file, `src/render/backdrop.ts`, importing only `three`. It builds a `THREE.Group` named `'backdrop'` holding 5 hill meshes and 3 cloud meshes, all drawn from two shared `SphereGeometry` instances and three shared `MeshLambertMaterial`s. Hills are upper hemispheres (`thetaLength = PI / 2`) so the flat bottom edge makes `position.y` the base line and `scale.y` the height; clouds are full spheres scaled wide and flat. `src/render/index.ts` gains exactly one re-export line. Nothing is wired into `createRenderScene` or `main.ts` — that is a later ticket.

**Tech Stack:** TypeScript, three@0.180 (`THREE.SphereGeometry`, `THREE.MeshLambertMaterial`, `THREE.Group`), vitest + jsdom.

**Spec:** `/home/box/.claude/plans/brainstorming-you-are-implementing-polymorphic-candle.md` (approved 2026-08-26). Its constraints are restated in full below, so this plan stands alone.

## Global Constraints

- **Exactly three paths may change:** `src/render/backdrop.ts` (new), `src/render/index.ts` (+1 line), `tests/backdrop.test.ts` (new). Anything else in `git diff --stat` is a scope violation.
- Do NOT edit: `src/main.ts`, `src/render/tile-art.ts`, anything under `src/entities/`, or `tests/render.test.ts`.
- Do NOT change `BG_Z`, `createRenderScene`, `createTileLayer`, `createCamera`, or any existing function body in `src/render/index.ts`. Do not reformat that file.
- The ONLY allowed `index.ts` change is one line inserted directly below the existing `export * from './tile-art.ts'` (line 5):
  `export { createBackdrop } from './backdrop.ts'`
  A **named** re-export, not `export *`, so the module's colour constants and `BACKDROP_Z` stay private.
- **`backdrop.ts` must NOT import from `./index.ts`.** `index.ts` re-exports this module, so importing back would close a cycle. The depth is a local `const BACKDROP_Z = -20`; `tests/backdrop.test.ts` pins it to `BG_Z` by asserting equality after importing `BG_Z` from `'../src/render'`.
- Materials are `MeshLambertMaterial` only — never `MeshStandardMaterial`, never `MeshPhysicalMaterial`. This matches `createTileLayer` and `createPlayerCapsule`.
- Colours are fixed: `HILL_FAR_COLOR = 0x4a7f6d`, `HILL_NEAR_COLOR = 0x3f6b47`, `CLOUD_COLOR = 0xf4f1e4`. All three are module-private `const`s (not exported).
- 5 hills + 3 clouds. Shared geometries and materials: 2 geometries, 3 materials, 8 meshes total.
- No physics, no AABB, no `userData['aabb']`, no update/tick function, no animation, no parallax.
- No `Math.random()` anywhere — layout is a literal table, matching the determinism discipline documented at the top of `src/render/tile-art.ts`.
- Child tagging follows `src/debug/overlay.ts`: `mesh.userData['kind'] = 'hill' | 'cloud'`, bracket notation, plus a matching `mesh.name`.
- `tsconfig.json` sets `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`. Indexed array access yields `T | undefined`; prefer `for...of` and guard-throw helpers over `arr[0]!`.
- Stay on branch `gfx/backdrop`. No `git worktree add`. No push, no merge, no Railway deploy. Do not touch other clones under `/workspace/untitled-25d-platformer*`.
- Git identity is not configured in this sandbox — pass `GIT_AUTHOR_*` / `GIT_COMMITTER_*` per command (shown in every commit step below).
- Commit message style follows the repo log: `T-041: <imperative summary>`. Not conventional-commits.

## Why the numbers are what they are

The camera is **orthographic** (`FRUSTUM_HEIGHT = 10`, `CAMERA_DISTANCE = 20`), so there is no perspective shrink at `z = -20` — backdrop geometry draws at true world size. Visible world is `y ∈ [-5, 5]` and, at 16:9, `x ≈ ±8.9`. Two consequences drive the layout table:

1. Hills overfill horizontally (`x ∈ ≈ ±15.5`) so a later parallax ticket can slide the layer without exposing an edge.
2. Every hill's base drops to `y = -6`, *below* the frustum floor, so no sky-coloured gap can show under the ridge line.

Small local Z offsets (far hills `-0.6`, near hills `-0.3`, clouds `+0.5`) give overlapping opaque silhouettes a real depth order instead of z-fighting. World Z therefore lands in `[-20.6, -19.5]` — far behind `GAMEPLAY_Z = 0` and comfortably inside the `[-40, -10]` background band the repo asserts elsewhere.

### Layout table

| kind | local z | x | scale.x (half-width) | scale.y (height) | y |
|---|---|---|---|---|---|
| hill (far) | -0.6 | -9.0 | 6.5 | 8.2 | -6.0 |
| hill (far) | -0.6 | -0.5 | 5.0 | 8.2 | -6.0 |
| hill (far) | -0.6 | 8.5 | 7.0 | 8.4 | -6.0 |
| hill (near) | -0.3 | -5.5 | 5.0 | 5.6 | -6.0 |
| hill (near) | -0.3 | 3.5 | 5.8 | 5.9 | -6.0 |
| cloud | +0.5 | -6.5 | 2.4 | 0.85 | 3.2 |
| cloud | +0.5 | 1.5 | 1.8 | 0.70 | 4.0 |
| cloud | +0.5 | 7.5 | 2.8 | 0.95 | 2.6 |

Far hills top out at `y ≈ 2.2`; near hills peak at `y ≈ -0.4` and `-0.1`, below the far ridge, which is what makes the two rows read as depth.

## File Structure

- **`src/render/backdrop.ts`** (new, ~120 lines) — the entire feature. Owns the layout table, the colour constants, the local `BACKDROP_Z`, and the single exported factory. Depends on `three` and nothing else in the repo.
- **`src/render/index.ts`** (modify, +1 line at line 6) — the re-export, so consumers import `createBackdrop` from `'../src/render'` alongside `BG_Z`.
- **`tests/backdrop.test.ts`** (new) — the whole test surface. A new file rather than an addition to `tests/render.test.ts`, so this ticket cannot collide with other in-flight work. `vitest.config.ts` already globs `tests/**/*.test.ts`, so no config change is needed.

---

### Task 1: The empty backdrop group and its re-export

Establishes the module, the re-export path, and the depth contract. Deliberately produces a childless group — hills arrive in Task 2, clouds in Task 3.

**Files:**
- Create: `src/render/backdrop.ts`
- Modify: `src/render/index.ts` (insert one line after line 5)
- Test: `tests/backdrop.test.ts` (create)

**Interfaces:**
- Consumes: `BG_Z` (`number`, value `-20`) from `src/render/index.ts` — test-side only.
- Produces: `createBackdrop(): THREE.Group` — exported from `src/render/backdrop.ts` and re-exported from `src/render/index.ts`. Tasks 2 and 3 add children to the group this task returns.

- [ ] **Step 1: Write the failing test**

Create `tests/backdrop.test.ts` with the shared helpers plus the first two tests. The helpers are used by every later task — write them now, in full.

```ts
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { BG_Z, FRUSTUM_HEIGHT, GAMEPLAY_Z, createBackdrop } from '../src/render'

/**
 * Raw 0-255 channels straight off the hex, the way tests/palette.test.ts reads colours.
 * Going through the hex sidesteps three's sRGB-to-linear conversion of Color.r/g/b, so the
 * numbers asserted here are the numbers written in the source.
 */
function channels(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

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

function childrenOfKind(group: THREE.Object3D, kind: string): THREE.Mesh[] {
  return group.children.filter(isMesh).filter((mesh) => mesh.userData['kind'] === kind)
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

describe('createBackdrop', () => {
  test('is a Group parked on the background plane', () => {
    const backdrop = createBackdrop()

    expect(backdrop).toBeInstanceOf(THREE.Object3D)
    expect(backdrop).toBeInstanceOf(THREE.Group)
    expect(backdrop.name).toBe('backdrop')

    // BACKDROP_Z is duplicated inside backdrop.ts rather than imported, to avoid a cycle
    // with the re-export. This is the assertion that keeps the duplicate honest.
    expect(backdrop.position.z).toBe(BG_Z)
    expect(backdrop.position.z).toBe(-20)
    expect(backdrop.position.z).toBeLessThan(GAMEPLAY_Z)
  })

  test('returns a fresh group per call, so two scenes never share one', () => {
    const first = createBackdrop()
    const second = createBackdrop()

    expect(first).not.toBe(second)
    expect(first.children).toHaveLength(second.children.length)
  })
})
```

`FRUSTUM_HEIGHT`, `channels`, `isPbrMaterial`, `childrenOfKind`, `sphereParams`, `colorOf`, and `worldZOf` are unused until Tasks 2-3. Vitest does not fail on unused locals, but `npm run typecheck` does (`noUnusedLocals`). **Do not run `npm run typecheck` until Task 3 is complete** — Step 5 below runs the test suite only. This is called out again in Task 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/backdrop.test.ts`

Expected: FAIL at import resolution — something like `No matching export in "src/render/index.ts" for import "createBackdrop"`, or `createBackdrop is not a function`. If it fails for any other reason, stop and diagnose before writing code.

- [ ] **Step 3: Write minimal implementation**

Create `src/render/backdrop.ts`:

```ts
import * as THREE from 'three'

/**
 * Sky backdrop: hill silhouettes under a few clouds, parked on the background plane.
 *
 * Visual only — no physics body, no AABB, no per-frame update.
 *
 * NOT WIRED TO ANYTHING ON SCREEN yet. `createRenderScene` still paints its background with
 * a flat instanced tile layer, and main.ts never calls this. Hooking it up is a later ticket.
 *
 * The camera is orthographic (see FRUSTUM_HEIGHT in ./index.ts), so nothing here shrinks with
 * distance the way a perspective backdrop would — geometry at BACKDROP_Z draws at true world
 * size. Everything below is therefore sized against the frustum directly.
 */

/**
 * Depth of the layer. Mirrors `BG_Z` in ./index.ts, deliberately duplicated rather than
 * imported: index.ts re-exports this module, so importing back from it would close a cycle.
 * `tests/backdrop.test.ts` asserts the two stay equal.
 */
const BACKDROP_Z = -20

/** Hills and clouds for the background plane. A fresh group every call — two scenes must
 *  never share one object. */
export function createBackdrop(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'backdrop'
  group.position.z = BACKDROP_Z
  return group
}
```

Then insert exactly one line into `src/render/index.ts`, directly below line 5. The result reads:

```ts
export * from './tile-art.ts'
export { createBackdrop } from './backdrop.ts'
```

Change nothing else in that file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/backdrop.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/backdrop.ts src/render/index.ts tests/backdrop.test.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ashtilawat23@gmail.com" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ashtilawat23@gmail.com" \
git commit -m "$(cat <<'EOF'
T-041: park an empty backdrop group on the background plane

The depth constant is duplicated in backdrop.ts rather than imported from
index.ts, which re-exports it — importing back would close a cycle. The
test pins the duplicate to BG_Z so it cannot drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Hills

**Files:**
- Modify: `src/render/backdrop.ts`
- Test: `tests/backdrop.test.ts` (append)

**Interfaces:**
- Consumes: `createBackdrop(): THREE.Group` from Task 1.
- Produces: hill meshes as direct children of that group, each tagged `userData['kind'] === 'hill'` and `name === 'hill'`. Task 3 reads `hill.position.z` to place clouds in front of them.

- [ ] **Step 1: Write the failing test**

Append to `tests/backdrop.test.ts`:

```ts
describe('backdrop hills', () => {
  test('are dome silhouettes in muted green', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    expect(hills.length).toBeGreaterThanOrEqual(2)

    for (const hill of hills) {
      const params = sphereParams(hill)

      // thetaLength stops the sweep at the equator: a dome with a flat bottom edge, not a
      // ball. That is what lets position.y be the base line and scale.y the height.
      expect(params.thetaLength).toBeCloseTo(Math.PI / 2, 5)
      // Cheap. A background silhouette does not need a smooth limb.
      expect(params.widthSegments).toBeLessThanOrEqual(16)

      const { r, g, b } = channels(colorOf(hill))
      expect(g).toBeGreaterThan(r)
      expect(g).toBeGreaterThan(b)
    }
  })

  test('overfill the frustum, so no sky shows past or under the ridge', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    // Orthographic: no perspective shrink at BG_Z, so frustum units are world units.
    const halfWidth = (FRUSTUM_HEIGHT / 2) * (16 / 9)
    const floor = -FRUSTUM_HEIGHT / 2

    const left = Math.min(...hills.map((hill) => hill.position.x - hill.scale.x))
    const right = Math.max(...hills.map((hill) => hill.position.x + hill.scale.x))
    const highestBase = Math.max(...hills.map((hill) => hill.position.y))

    expect(left).toBeLessThan(-halfWidth)
    expect(right).toBeGreaterThan(halfWidth)
    // Bases sit below the frustum floor, so the domes never reveal their flat bottom edge.
    expect(highestBase).toBeLessThanOrEqual(floor)
  })

  test('form two rows at distinct depths, all behind gameplay', () => {
    const backdrop = createBackdrop()
    backdrop.updateMatrixWorld(true)
    const hills = childrenOfKind(backdrop, 'hill')

    // Two rows, so overlapping opaque domes depth-sort instead of z-fighting.
    const depths = new Set(hills.map((hill) => hill.position.z))
    expect(depths.size).toBeGreaterThanOrEqual(2)

    for (const hill of hills) {
      for (const material of materialsOf(hill)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(hill)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/backdrop.test.ts`
Expected: FAIL — `expect(hills.length).toBeGreaterThanOrEqual(2)` gets 0, and the two `Math.min(...[])` / `Math.max(...[])` calls yield `Infinity` / `-Infinity`. All three new tests red; the two from Task 1 still green.

- [ ] **Step 3: Write minimal implementation**

In `src/render/backdrop.ts`, add below `BACKDROP_Z` (before `createBackdrop`):

```ts
/** Hazier teal-green for the far hill row, so it reads as distance. */
const HILL_FAR_COLOR = 0x4a7f6d

/**
 * Deeper muted green for the near row. Both tones sit duller and darker than
 * GRASS_TOP_COLOR, so the backdrop recedes behind the playfield instead of competing
 * with it for the eye.
 */
const HILL_NEAR_COLOR = 0x3f6b47

/**
 * Local Z offsets: small enough to keep every mesh inside the background band, large enough
 * to give overlapping opaque silhouettes a real depth order instead of z-fighting.
 */
const FAR_HILL_Z = -0.6
const NEAR_HILL_Z = -0.3

/** Hill bases sit below the frustum floor (y = -5), so no sky shows under the ridge and the
 *  domes never reveal their flat bottom edge. */
const HILL_BASE_Y = -6

/** Flattening applied to every silhouette's depth. The layer is read head-on, so thickness
 *  is wasted geometry — it needs just enough not to look like cut cardboard. */
const SILHOUETTE_DEPTH = 0.35

interface HillSpec {
  x: number
  halfWidth: number
  height: number
  far: boolean
}

/**
 * The far row tops out around y = 2.2; the near row peaks below it, which is what makes the
 * two read as depth rather than as clutter. Spans overlap horizontally so the ridge line is
 * unbroken across the frustum, and reach past x = ±8.9 (the 16:9 frustum edge) so a later
 * parallax pass can slide the layer without exposing an edge.
 *
 * Literal, never generated: Math.random has no place here, for the same reason it has none
 * in tile-art.ts — the art has to come out identical on every call so it can be asserted.
 */
const HILLS: readonly HillSpec[] = [
  { x: -9, halfWidth: 6.5, height: 8.2, far: true },
  { x: -0.5, halfWidth: 5, height: 8.2, far: true },
  { x: 8.5, halfWidth: 7, height: 8.4, far: true },
  { x: -5.5, halfWidth: 5, height: 5.6, far: false },
  { x: 3.5, halfWidth: 5.8, height: 5.9, far: false },
]

/**
 * Upper hemisphere: `thetaLength = PI / 2` stops the sweep at the equator, leaving a flat
 * bottom edge at local y = 0. That makes position.y the hill's base line and scale.y its
 * height, and costs half the triangles of a full sphere.
 */
function createHillGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
}
```

Then extend `createBackdrop` — the group setup is unchanged, the loop is new:

```ts
export function createBackdrop(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'backdrop'
  group.position.z = BACKDROP_Z

  const hillGeometry = createHillGeometry()
  const farHillMaterial = new THREE.MeshLambertMaterial({ color: HILL_FAR_COLOR })
  const nearHillMaterial = new THREE.MeshLambertMaterial({ color: HILL_NEAR_COLOR })

  for (const hill of HILLS) {
    const mesh = new THREE.Mesh(hillGeometry, hill.far ? farHillMaterial : nearHillMaterial)
    mesh.name = 'hill'
    mesh.userData['kind'] = 'hill'
    mesh.position.set(hill.x, HILL_BASE_Y, hill.far ? FAR_HILL_Z : NEAR_HILL_Z)
    mesh.scale.set(hill.halfWidth, hill.height, SILHOUETTE_DEPTH)
    group.add(mesh)
  }

  return group
}
```

Note `SILHOUETTE_DEPTH` is declared here but also used by clouds in Task 3 — that is intended, not a leftover.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/backdrop.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/backdrop.ts tests/backdrop.test.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ashtilawat23@gmail.com" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ashtilawat23@gmail.com" \
git commit -m "$(cat <<'EOF'
T-041: raise two rows of hill domes on the backdrop

Hemispheres rather than spheres: the flat bottom edge makes position.y the
base line and halves the triangle count. Bases drop below the frustum floor
so no sky shows under the ridge, and the rows sit at distinct depths so
overlapping opaque silhouettes sort instead of z-fighting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Clouds, and the whole-layer cost budget

**Files:**
- Modify: `src/render/backdrop.ts`
- Test: `tests/backdrop.test.ts` (append)

**Interfaces:**
- Consumes: `createBackdrop(): THREE.Group` with hill children from Task 2.
- Produces: the finished layer — 8 meshes over 2 geometries and 3 materials. Nothing later in this plan depends on it; the wiring ticket does.

- [ ] **Step 1: Write the failing test**

Append to `tests/backdrop.test.ts`:

```ts
describe('backdrop clouds', () => {
  test('are flattened cream ellipsoids in open sky, in front of the hills', () => {
    const backdrop = createBackdrop()
    const clouds = childrenOfKind(backdrop, 'cloud')
    const hills = childrenOfKind(backdrop, 'hill')

    expect(clouds.length).toBeGreaterThanOrEqual(2)

    const frontmostHillZ = Math.max(...hills.map((hill) => hill.position.z))

    for (const cloud of clouds) {
      const params = sphereParams(cloud)
      // A full sphere, unlike the hill domes — a cloud has no horizon to sit on.
      expect(params.thetaLength).toBeCloseTo(Math.PI, 5)
      expect(params.widthSegments).toBeLessThanOrEqual(16)

      // Flattened, or it reads as a ball rather than a cloud.
      expect(cloud.scale.x).toBeGreaterThan(cloud.scale.y * 1.5)
      // Up in open sky, clear of the far ridge line.
      expect(cloud.position.y).toBeGreaterThan(0)
      // In front of every hill, so an overlap depth-sorts instead of z-fighting.
      expect(cloud.position.z).toBeGreaterThan(frontmostHillZ)

      const { r, g, b } = channels(colorOf(cloud))
      expect(Math.min(r, g, b)).toBeGreaterThan(200)
    }
  })

  test('stay in Lambert and behind gameplay, like the rest of the layer', () => {
    const backdrop = createBackdrop()
    backdrop.updateMatrixWorld(true)

    for (const cloud of childrenOfKind(backdrop, 'cloud')) {
      for (const material of materialsOf(cloud)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(cloud)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('backdrop cost', () => {
  test('is a handful of meshes over shared geometries and materials', () => {
    const backdrop = createBackdrop()
    const meshes = backdrop.children.filter(isMesh)

    // Nothing but meshes hangs off the group: no stray lights, no nested groups.
    expect(meshes).toHaveLength(backdrop.children.length)
    expect(meshes.length).toBeLessThanOrEqual(12)

    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))

    expect(geometries.size).toBeLessThanOrEqual(2)
    expect(materials.size).toBeLessThanOrEqual(3)
  })

  test('carries no physics: this layer is visual only', () => {
    const backdrop = createBackdrop()

    expect('update' in backdrop).toBe(false)
    expect(backdrop.userData['aabb']).toBeUndefined()

    for (const child of backdrop.children) {
      expect(child.userData['aabb']).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/backdrop.test.ts`
Expected: FAIL — `expect(clouds.length).toBeGreaterThanOrEqual(2)` gets 0, and the cost test's `geometries.size` is 1 with only one *kind* of child (that assertion is `<=`, so it will actually pass; the two cloud tests are the red ones). The 5 tests from Tasks 1-2 stay green.

- [ ] **Step 3: Write minimal implementation**

In `src/render/backdrop.ts`, add alongside the hill constants:

```ts
/** Warm cream rather than pure white, so clouds read as lit instead of as holes in the sky. */
const CLOUD_COLOR = 0xf4f1e4

/** Clouds ride in front of both hill rows. */
const CLOUD_LOCAL_Z = 0.5

interface CloudSpec {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
}

/** Three puffs, unevenly spaced and unevenly sized — a regular rhythm would read as a
 *  pattern. One sphere each, not a cluster: the cheapest thing that still reads. */
const CLOUDS: readonly CloudSpec[] = [
  { x: -6.5, y: 3.2, halfWidth: 2.4, halfHeight: 0.85 },
  { x: 1.5, y: 4, halfWidth: 1.8, halfHeight: 0.7 },
  { x: 7.5, y: 2.6, halfWidth: 2.8, halfHeight: 0.95 },
]

function createCloudGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(1, 12, 8)
}
```

Then extend `createBackdrop`, adding the cloud geometry and material next to the hill ones and a second loop before `return group`:

```ts
  const cloudGeometry = createCloudGeometry()
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: CLOUD_COLOR })

  for (const cloud of CLOUDS) {
    const mesh = new THREE.Mesh(cloudGeometry, cloudMaterial)
    mesh.name = 'cloud'
    mesh.userData['kind'] = 'cloud'
    mesh.position.set(cloud.x, cloud.y, CLOUD_LOCAL_Z)
    mesh.scale.set(cloud.halfWidth, cloud.halfHeight, SILHOUETTE_DEPTH)
    group.add(mesh)
  }

  return group
```

- [ ] **Step 4: Run the full suite and the typechecker**

The whole test file now exists, so every helper is used and `noUnusedLocals` is satisfied. This is the first point at which `typecheck` should be run.

Run: `npm test`
Expected: PASS — 9 tests in `tests/backdrop.test.ts`, and every pre-existing suite still green. `tests/render.test.ts` in particular must be untouched and passing; its `createRenderScene` test asserts exact child counts, so it is the tripwire for accidental wiring.

Run: `npm run typecheck`
Expected: clean, no output.

- [ ] **Step 5: Commit**

```bash
git add src/render/backdrop.ts tests/backdrop.test.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ashtilawat23@gmail.com" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ashtilawat23@gmail.com" \
git commit -m "$(cat <<'EOF'
T-041: float three cream clouds over the hills

Full spheres scaled flat, parked in front of both hill rows so an overlap
sorts rather than z-fights. The layer closes at 8 meshes over 2 shared
geometries and 3 shared materials, which the cost test pins.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Scope audit

No code changes and no commit — a gate that catches the failure mode this ticket is most exposed to, which is touching a file it was told not to.

**Files:** none modified.

- [ ] **Step 1: Confirm the branch**

Run: `git branch --show-current`
Expected: `gfx/backdrop`. If not, stop — do not check out anything else, report instead.

- [ ] **Step 2: Confirm exactly three paths changed**

Run: `git diff --stat origin/main...HEAD`

Expected exactly:
```
 docs/superpowers/plans/2026-08-26-t041-sky-hills-backdrop.md | ...
 src/render/backdrop.ts                                       | ...
 src/render/index.ts                                          | 1 +
 tests/backdrop.test.ts                                       | ...
```

Any other path — especially `src/main.ts`, `src/render/tile-art.ts`, `src/entities/*`, or `tests/render.test.ts` — is a scope violation. Revert it.

(The plan document appears only if it was committed; leaving it uncommitted is fine and expected.)

- [ ] **Step 3: Confirm `index.ts` gained one line and lost none**

Run: `git diff origin/main...HEAD -- src/render/index.ts`

Expected: a single `+export { createBackdrop } from './backdrop.ts'` and zero `-` lines.

- [ ] **Step 4: Confirm the backdrop is not wired in**

Run: `grep -n "createBackdrop" src/render/index.ts src/main.ts`

Expected: exactly one hit, the re-export line in `index.ts`. No hit in `main.ts`. Wiring is a later ticket.

- [ ] **Step 5: Confirm there is no import cycle**

Run: `grep -n "^import" src/render/backdrop.ts`

Expected: exactly one line, `import * as THREE from 'three'`. Any import of `./index.ts` closes a cycle with the re-export.

- [ ] **Step 6: Final green**

Run: `npm test && npm run typecheck`
Expected: full suite passes, typecheck clean.

Do NOT push, merge, or deploy. Report the branch state and stop.

---

## Self-Review

**Spec coverage** — every requirement maps to a task:

| Spec requirement | Task |
|---|---|
| New `src/render/backdrop.ts` | 1 |
| One-line named re-export in `index.ts` | 1 |
| `THREE.Group` named `'backdrop'`, `position.z === BG_Z === -20` | 1 |
| Local `BACKDROP_Z`, no import from `./index.ts` | 1, verified in 4 |
| Fresh instance per call | 1 |
| 5 hills, hemisphere `SphereGeometry`, `0x4a7f6d` / `0x3f6b47`, `userData.kind = 'hill'` | 2 |
| 3 clouds, flattened `SphereGeometry`, `0xf4f1e4`, `userData.kind = 'cloud'` | 3 |
| Shared geometries and materials, cheap | 3 (cost test) |
| `MeshLambertMaterial` only, never Standard/Physical | 2 (hills), 3 (clouds) |
| Behind gameplay, inside `[-40, -10]` | 2 (hills), 3 (clouds) |
| No physics, no AABB, no animation | 3 (visual-only test) |
| Not wired into `createRenderScene` / `main.ts` | 4 (grep) |
| Tests in new `tests/backdrop.test.ts` only | 1-3, verified in 4 |
| Stay on `gfx/backdrop`, no push/merge/deploy | 4 |

**Type consistency** — `createBackdrop(): THREE.Group` is the only exported name and is spelled identically in `backdrop.ts`, the `index.ts` re-export, and all three test imports. `HillSpec` / `CloudSpec` are module-private and used only by their own tables. `userData['kind']` uses bracket notation in both source and tests, matching `src/debug/overlay.ts`. `SILHOUETTE_DEPTH` is introduced in Task 2 and reused in Task 3 — flagged inline so a Task-2 reviewer does not read it as dead code.

**Known sharp edge** — the test file's helpers are all written in Task 1 but some go unused until Task 3. `noUnusedLocals` would reject that intermediate state, so `npm run typecheck` is deliberately deferred to Task 3 Step 4. This is stated in both places.
