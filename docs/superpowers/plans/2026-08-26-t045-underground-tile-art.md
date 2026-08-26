# T-045 Underground Tile Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `underground` theme its own dark tile art, and stop the World 1-1 grass instance colors from leaking green through the underground and castle maps.

**Architecture:** All product logic lands in `src/render/tile-art.ts`. A third theme gets its own grayscale detail map (flat, grooved, coarse-speckled — no lit grass crown), and `TileArt` grows an optional `instanceTint` that a theme uses to repaint an `InstancedMesh`'s per-instance colors. Grass declares no tint, so 1-1 keeps its palette byte-for-byte.

**Tech Stack:** TypeScript, three.js r180 (`DataTexture`, `InstancedMesh`), vitest + jsdom.

**Spec:** `/home/box/.claude/plans/brainstorming-you-are-executing-robust-waffle.md` (T-045 design, approved)

## Global Constraints

- Branch `gfx/underground` in this worktree only. No worktree add, no clone, no branch switch, no push, no merge.
- Product files touchable: `src/render/tile-art.ts`; at most a one-line comment in `src/render/index.ts`.
- Hard no-touch: `src/main.ts`, `src/render/backdrop.ts`, level JSON, walkers, coins, physics, entities.
- Tests live in `tests/tile-art.test.ts`. The existing test `applyTileArt > leaves the per-instance palette and the base color untouched` stays **verbatim**.
- `applyTileArt` must never allocate `instanceColor` and never touch `material.color`.
- Exact values: `UNDERGROUND_THEME = 'underground'`, `UNDERGROUND_LUMA_FLOOR = 140`, `UNDERGROUND_BASE_LUMA = 210`, `UNDERGROUND_GROOVE = -55`, `UNDERGROUND_SPECKLE = [-14, -7, 0, 7]`, `UNDERGROUND_ROCK_COLOR = 0x46506b`, `CASTLE_INSTANCE_TINT = 0xffffff`, `UNDERGROUND_SKY_COLOR = 0x0a0e1a`.
- Test command: `npx vitest run tests/tile-art.test.ts`. Full suite: `npm test`. Types: `npm run typecheck`.

---

### Task 1: Underground detail texture

**Files:**
- Modify: `src/render/tile-art.ts` (after `createGroundDetailTexture`, before the brick block)
- Test: `tests/tile-art.test.ts`

**Interfaces:**
- Consumes: existing module-private `hash2`, `clamp`, `createArtTexture`, `TILE_ART_SIZE`.
- Produces: `export function createUndergroundDetailTexture(): THREE.DataTexture`, `export const UNDERGROUND_LUMA_FLOOR = 140`, `export const UNDERGROUND_THEME = 'underground'`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('createUndergroundDetailTexture', () => {
  test('is a 16x16 RGBA DataTexture flagged for upload', () => {
    const texture = createUndergroundDetailTexture()
    expect(texture).toBeInstanceOf(THREE.DataTexture)
    expect(texture.image.width).toBe(TILE_ART_SIZE)
    expect(texture.image.height).toBe(TILE_ART_SIZE)
    expect(pixels(texture).length).toBe(TILE_ART_SIZE * TILE_ART_SIZE * 4)
    expect(texture.version).toBeGreaterThan(0)
    expect(texture.flipY).toBe(false)
    everyTexel(texture, (t) => expect(t.a).toBe(255))
  })

  test('is grayscale, so the rock tint multiplies through it', () => {
    const texture = createUndergroundDetailTexture()
    everyTexel(texture, (t, x, y) => {
      expect(`${x},${y}:${t.r},${t.g},${t.b}`).toBe(`${x},${y}:${t.r},${t.r},${t.r}`)
    })
  })

  test('sits below the grass floor without crushing to black', () => {
    const texture = createUndergroundDetailTexture()
    everyTexel(texture, (t) => {
      expect(t.r).toBeGreaterThanOrEqual(UNDERGROUND_LUMA_FLOOR)
      expect(t.r).toBeLessThanOrEqual(255)
    })
    expect(UNDERGROUND_LUMA_FLOOR).toBeLessThan(GROUND_LUMA_FLOOR)
  })

  test('is not a flat fill', () => {
    const shades = new Set<number>()
    everyTexel(createUndergroundDetailTexture(), (t) => shades.add(t.r))
    expect(shades.size).toBeGreaterThan(4)
  })

  test('has no lit crown — a cave tile is not sun-lit from above', () => {
    const texture = createUndergroundDetailTexture()
    const top = meanLumaOfRows(texture, [12, 13, 14, 15])
    const bottom = meanLumaOfRows(texture, [0, 1, 2, 3])
    expect(Math.abs(top - bottom)).toBeLessThan(8)
  })

  test('cuts a dark groove around all four edges', () => {
    const texture = createUndergroundDetailTexture()
    const interior = meanOfInterior(texture)
    expect(meanLumaOfRows(texture, [0])).toBeLessThan(interior - 20)
    expect(meanLumaOfRows(texture, [TILE_ART_SIZE - 1])).toBeLessThan(interior - 20)
    expect(meanLumaOfColumns(texture, [0])).toBeLessThan(interior - 20)
    expect(meanLumaOfColumns(texture, [TILE_ART_SIZE - 1])).toBeLessThan(interior - 20)
  })

  test('is deterministic and hands back a fresh texture each call', () => {
    expect(Array.from(pixels(createUndergroundDetailTexture()))).toEqual(
      Array.from(pixels(createUndergroundDetailTexture())),
    )
    expect(createUndergroundDetailTexture()).not.toBe(createUndergroundDetailTexture())
  })
})
```

Add two helpers beside the existing `meanLumaOfRows`:

```typescript
function meanLumaOfColumns(texture: THREE.DataTexture, columns: number[]): number {
  let total = 0
  for (const x of columns) {
    for (let y = 0; y < texture.image.height; y += 1) total += luma(texel(texture, x, y))
  }
  return total / (columns.length * texture.image.height)
}

function meanOfInterior(texture: THREE.DataTexture): number {
  let total = 0
  let count = 0
  for (let y = 1; y < texture.image.height - 1; y += 1) {
    for (let x = 1; x < texture.image.width - 1; x += 1) {
      total += luma(texel(texture, x, y))
      count += 1
    }
  }
  return total / count
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/tile-art.test.ts`
Expected: FAIL — `createUndergroundDetailTexture is not a function` / no export named it.

- [ ] **Step 3: Minimal implementation**

```typescript
/** `Level.theme` value for the underground caves of World 1-3. */
export const UNDERGROUND_THEME = 'underground'

/** Floor for the underground map. Darker than the ground floor, still short of black. */
export const UNDERGROUND_LUMA_FLOOR = 140

const UNDERGROUND_BASE_LUMA = 210
/** Depth of the 1-texel seam cut around the tile, which is what reads as a stone block. */
const UNDERGROUND_GROOVE = -55
/** Coarser than the ground speckle and applied in 2x2 blocks: rough rock, not turf. */
const UNDERGROUND_SPECKLE = [-14, -7, 0, 7]

function undergroundLuma(x: number, y: number): number {
  const onEdge = x === 0 || y === 0 || x === TILE_ART_SIZE - 1 || y === TILE_ART_SIZE - 1
  const groove = onEdge ? UNDERGROUND_GROOVE : 0
  // Fold the row about the tile's middle so row y and row SIZE-1-y are identical: the
  // "no lit crown" property then holds exactly, rather than up to speckle noise.
  const foldedRow = Math.min(y, TILE_ART_SIZE - 1 - y)
  const speckle = UNDERGROUND_SPECKLE[hash2(x >> 1, foldedRow >> 1) % UNDERGROUND_SPECKLE.length]!
  return clamp(UNDERGROUND_BASE_LUMA + groove + speckle, UNDERGROUND_LUMA_FLOOR, 255)
}

export function createUndergroundDetailTexture(): THREE.DataTexture {
  return createArtTexture((x, y) => {
    const luma = undergroundLuma(x, y)
    return [luma, luma, luma]
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/tile-art.test.ts` → PASS.

---

### Task 2: Theme routing and the rock palette

**Files:**
- Modify: `src/render/tile-art.ts:172-203` (`TileArt`, `tileArtForTheme`)
- Test: `tests/tile-art.test.ts`

**Interfaces:**
- Consumes: `createUndergroundDetailTexture`, `UNDERGROUND_THEME` from Task 1.
- Produces: `export const UNDERGROUND_ROCK_COLOR = 0x46506b`; `tileArtForTheme(UNDERGROUND_THEME)` returns `{ texture, color: UNDERGROUND_ROCK_COLOR, instanceTint: UNDERGROUND_ROCK_COLOR }`.

- [ ] **Step 1: Write the failing tests**

```typescript
test('routes underground to its own art, not the grass fallback', () => {
  expect(Array.from(pixels(tileArtForTheme(UNDERGROUND_THEME).texture))).toEqual(
    Array.from(pixels(createUndergroundDetailTexture())),
  )
  expect(tileArtForTheme(UNDERGROUND_THEME).texture).not.toBe(
    tileArtForTheme(GRASS_THEME).texture,
  )
  expect(tileArtForTheme(UNDERGROUND_THEME).color).toBe(UNDERGROUND_ROCK_COLOR)
  expect(tileArtForTheme(UNDERGROUND_THEME).color).not.toBe(GRASS_TOP_COLOR)
})

test('memoizes the underground art too', () => {
  expect(tileArtForTheme(UNDERGROUND_THEME).texture).toBe(
    tileArtForTheme(UNDERGROUND_THEME).texture,
  )
  expect(tileArtForTheme(UNDERGROUND_THEME).texture).not.toBe(
    tileArtForTheme(CASTLE_THEME).texture,
  )
})

test('UNDERGROUND_ROCK_COLOR is a cool slate darker than the whole ground palette', () => {
  const rgb = (hex: number) => ({ r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff })
  const rock = rgb(UNDERGROUND_ROCK_COLOR)
  expect(rock.b).toBeGreaterThan(rock.g)
  expect(rock.g).toBeGreaterThan(rock.r)
  expect(luma(hexTexel(UNDERGROUND_ROCK_COLOR))).toBeLessThan(luma(hexTexel(GRASS_TOP_COLOR)))
  expect(luma(hexTexel(UNDERGROUND_ROCK_COLOR))).toBeLessThan(luma(hexTexel(DIRT_COLOR)))
})
```

with helper `function hexTexel(hex: number): Texel { return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff, a: 255 } }`.

The existing `falls back to the ground art for an unknown theme` test stays untouched and must stay green.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — underground resolves to the grass texture / `UNDERGROUND_ROCK_COLOR` undefined.

- [ ] **Step 3: Minimal implementation**

```typescript
/** Cool slate rock for the underground caves — the inverse of the warm castle brick. */
export const UNDERGROUND_ROCK_COLOR = 0x46506b

const KNOWN_THEMES = new Set<string>([GRASS_THEME, CASTLE_THEME, UNDERGROUND_THEME])

// inside tileArtForTheme, replacing the two-way key:
const key = KNOWN_THEMES.has(theme) ? theme : GRASS_THEME
...
const art: TileArt =
  key === CASTLE_THEME
    ? { texture: createBrickTexture(), color: CASTLE_BRICK_COLOR, instanceTint: CASTLE_INSTANCE_TINT }
    : key === UNDERGROUND_THEME
      ? {
          texture: createUndergroundDetailTexture(),
          color: UNDERGROUND_ROCK_COLOR,
          instanceTint: UNDERGROUND_ROCK_COLOR,
        }
      : { texture: createGroundDetailTexture(), color: GRASS_TOP_COLOR }
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/tile-art.test.ts` → PASS.

---

### Task 3: `instanceTint` and the `applyTileArt` repaint

**Files:**
- Modify: `src/render/tile-art.ts:172-222` (`TileArt` interface, `applyTileArt`)
- Test: `tests/tile-art.test.ts`

**Interfaces:**
- Produces: `TileArt.instanceTint?: number`, `export const CASTLE_INSTANCE_TINT = 0xffffff`, and an `applyTileArt` that repaints instance colors when the theme declares a tint.

- [ ] **Step 1: Write the failing tests**

```typescript
function instanceColors(mesh: THREE.InstancedMesh): number[] {
  return Array.from(mesh.instanceColor!.array)
}

function expectedTint(hex: number, instances: number): number[] {
  const rgb = new THREE.Color().setHex(hex).toArray()
  return Array.from({ length: instances }, () => rgb).flat()
}

test('overwrites the grass palette with rock for the underground theme', () => {
  const mesh = paletteMesh()
  const version = mesh.instanceColor!.version

  applyTileArt(mesh, UNDERGROUND_THEME)

  const expected = expectedTint(UNDERGROUND_ROCK_COLOR, mesh.count)
  instanceColors(mesh).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5))
  expect(mesh.instanceColor!.version).toBeGreaterThan(version)
  expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
    tileArtForTheme(UNDERGROUND_THEME).texture,
  )
  expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0xffffff)
})

test('the repainted underground tiles are darker than the grass they replaced', () => {
  const before = paletteMesh()
  const after = paletteMesh()

  applyTileArt(after, UNDERGROUND_THEME)

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  expect(sum(instanceColors(after))).toBeLessThan(sum(instanceColors(before)))
})

test('overwrites the grass palette with white for castle, so no green leaks into the brick', () => {
  const mesh = paletteMesh()
  const version = mesh.instanceColor!.version

  applyTileArt(mesh, CASTLE_THEME)

  const expected = expectedTint(CASTLE_INSTANCE_TINT, mesh.count)
  instanceColors(mesh).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5))
  expect(mesh.instanceColor!.version).toBeGreaterThan(version)
})

test('never allocates an instance color buffer that was not already there', () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0x4488ff }),
    2,
  )

  applyTileArt(mesh, UNDERGROUND_THEME)

  expect(mesh.instanceColor).toBeNull()
  expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
    tileArtForTheme(UNDERGROUND_THEME).texture,
  )
  expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0x4488ff)
})

test('leaves a plain non-instanced mesh alone apart from the map', () => {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0xff00ff }),
  )

  expect(() => applyTileArt(mesh, UNDERGROUND_THEME)).not.toThrow()
  expect((mesh.material as THREE.MeshLambertMaterial).map).toBe(
    tileArtForTheme(UNDERGROUND_THEME).texture,
  )
  expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0xff00ff)
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — instance colors still hold the grass palette; `CASTLE_INSTANCE_TINT` undefined.

- [ ] **Step 3: Minimal implementation**

```typescript
/** Identity multiplier. The brick map carries its own color; any tint would stain it. */
export const CASTLE_INSTANCE_TINT = 0xffffff

export interface TileArt {
  texture: THREE.DataTexture
  color: number
  /**
   * Per-instance color this theme repaints onto a palette-tinted InstancedMesh, or undefined
   * to keep whatever palette the caller set.
   */
  instanceTint?: number
}

export function applyTileArt<T extends THREE.Mesh>(mesh: T, theme: string = GRASS_THEME): T {
  const { texture, instanceTint } = tileArtForTheme(theme)
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

  for (const material of materials) {
    if (!('map' in material)) continue
    ;(material as THREE.MeshLambertMaterial).map = texture
    material.needsUpdate = true
  }

  if (instanceTint !== undefined && mesh instanceof THREE.InstancedMesh && mesh.instanceColor) {
    const color = new THREE.Color().setHex(instanceTint)
    for (let i = 0; i < mesh.count; i += 1) mesh.setColorAt(i, color)
    mesh.instanceColor.needsUpdate = true
  }
  return mesh
}
```

Update the `applyTileArt` doc comment: it currently claims instance colors are never touched.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/tile-art.test.ts` → PASS, including the untouched grass palette test.

---

### Task 4: Underground sky hex

**Files:**
- Modify: `src/render/tile-art.ts` (export), `src/render/index.ts:37-38` (one comment line)
- Test: `tests/tile-art.test.ts`

**Interfaces:**
- Produces: `export const UNDERGROUND_SKY_COLOR = 0x0a0e1a`, re-exported through `src/render/index.ts`'s existing `export * from './tile-art.ts'`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('UNDERGROUND_SKY_COLOR', () => {
  test('is a near-black cave void, distinct from the grass sky', () => {
    expect(luma(hexTexel(UNDERGROUND_SKY_COLOR))).toBeLessThan(40)
    const { r, b } = hexTexel(UNDERGROUND_SKY_COLOR)
    expect(b).toBeGreaterThan(r)
    expect(UNDERGROUND_SKY_COLOR).not.toBe(SKY_COLOR)
  })
})
```

Import `SKY_COLOR` and `UNDERGROUND_SKY_COLOR` from `'../src/render'`.

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL, `UNDERGROUND_SKY_COLOR` is undefined.

- [ ] **Step 3: Minimal implementation**

```typescript
/**
 * Clear color for the underground theme: a near-black cave void, the counterpart to the
 * render module's grass `SKY_COLOR`. Exported for a future backdrop wire; nothing reads it yet.
 */
export const UNDERGROUND_SKY_COLOR = 0x0a0e1a
```

In `src/render/index.ts`, beside `SKY_COLOR`, add: `// The underground counterpart is UNDERGROUND_SKY_COLOR in tile-art.ts; not wired yet.`

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/tile-art.test.ts` → PASS.

---

### Task 5: Full verification and commit

- [ ] **Step 1:** `npx vitest run tests/tile-art.test.ts` → all green
- [ ] **Step 2:** `npm test` → full suite green (watch for `createTileLayer` regressions)
- [ ] **Step 3:** `npm run typecheck` → clean
- [ ] **Step 4: Commit** (branch `gfx/underground`; no push, no merge)

```bash
git add src/render/tile-art.ts src/render/index.ts tests/tile-art.test.ts docs/superpowers/plans/2026-08-26-t045-underground-tile-art.md
git commit -m "T-045: underground tile art, and stop grass tint leaking into other themes"
```

## Out of scope (leftovers)

- Sky/backdrop stays grass-blue on 1-3; `UNDERGROUND_SKY_COLOR` is exported and unconsumed by design.
- No surface-vs-buried two-tone underground: `applyTileArt` has no grid, and threading a theme-aware `tileColorAt` would mean editing no-touch `main.ts`.
- **`src/main.ts:594-597` now documents behavior that is false.** The comment at the one production call site says "Only `material.map` is touched, so the grayscale ground art multiplies with the grass/dirt instance colors set above." That holds for grass only; underground and castle overwrite those instance colors wholesale. It is the comment a future reader consults when debugging "why is 1-3 a flat color", so it points away from the answer. `main.ts` is hard no-touch under this plan — needs its own ticket to reword to "`material.map` plus, for themes that own one, the per-instance tint — see `TileArt.instanceTint`."
- **Nothing pins the level data to the theme constant.** `src/levels/data/1-3.json` says `"theme": "underground"` and `UNDERGROUND_THEME` is `'underground'`, but no test asserts `loadLevel('1-3').theme === UNDERGROUND_THEME` — a typo on either side degrades silently to grass, which is the exact bug T-045 exists to fix. `tests/wire-art-theme.test.ts` proves the boot path honours *castle*; there is no underground counterpart, so the new repaint is never exercised through `startGame`. Both fixes live outside this plan's test scope; follow-up ticket.
