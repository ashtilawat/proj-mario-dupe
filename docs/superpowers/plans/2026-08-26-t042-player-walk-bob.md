# T-042 Player Walk Bob Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the player is grounded and walking, the character mesh bobs with a classic walk-cycle vertical oscillation; idle and airborne are perfectly still.

**Architecture:** A visual offset on `mesh.position.y` only. A bob phase advances with *distance travelled* while grounded; a bob amplitude follows the walk speed and is shed through the existing `moveToward` helper so idle and airborne settle on a **bit-exact zero**. The offset curve `A·(1−cos φ)/2` is non-negative, so the character lifts off its rest pose and never sinks through the floor. T-026 squash/stretch keeps `mesh.scale` to itself; the two channels never interact. `body.aabb` is never touched.

**Tech Stack:** TypeScript, three.js, Vitest (`npx vitest run`), fixed 120 Hz sim step (`FIXED_DT = 1/120`).

**Spec:** `/home/box/.claude/plans/brainstorming-you-are-implementing-ethereal-leaf.md`

## Global Constraints

- Product code changes are confined to `src/entities/player/player.ts`. Do **NOT** edit `dash.ts`, `types.ts`, `index.ts`, any constants file, `main.ts`, `physics/`, or any other entity.
- Test changes are confined to the new `tests/player-bob.test.ts` plus the single approved amendment in `tests/player.test.ts` described in Task 2. Do **NOT** touch `tests/player-art.test.ts` or `tests/player-feel.test.ts` — other clones are editing those.
- `body.aabb`, `PLAYER_WIDTH` (0.7) and `PLAYER_HEIGHT` (1.5) must not change. The bob is a mesh offset only.
- Keep T-033 `createPlayerMesh`: 5 `BoxGeometry` parts, merged `BufferGeometry`, `vertexColors` Lambert, red hat / yellow head / blue overalls / brown shoes. Never revert to a capsule.
- Keep T-026 squash and stretch exactly as-is: `JUMP_STRETCH`, `LAND_SQUASH_MAX`, `LAND_SQUASH_MIN_SPEED`, `SQUASH_RECOVER_RATE`, and the volume-preserving `mesh.scale.set`. Do not retune any squash constant.
- Keep `const mesh = options.mesh ?? createPlayerMesh()` so tests can inject stubs.
- `node_modules` in this worktree is a **symlink** — never `git add` it.
- Git identity is not configured. Every commit must pass identity inline; never run `git config`:
  ```bash
  GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ash@users.noreply.local" \
  GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ash@users.noreply.local" \
  git commit -m "..."
  ```
- Never force-push, never skip hooks, never amend others' commits, never merge to main.
- Baseline at plan time: 35 files, **503 tests passing**. The `THREE.WebGLRenderer: Error creating WebGL context.` lines on stderr are pre-existing jsdom noise, not failures.

## File Structure

| File | Responsibility |
|---|---|
| `src/entities/player/player.ts` | Bob constants, the pure `walkBobOffset` curve, and the bob state advanced inside `step()`. Modify only. |
| `tests/player-bob.test.ts` | New. The whole T-042 suite: curve shape, activation gating, distance phasing, and the independence guard rails. |
| `tests/player.test.ts` | One approved amendment (Task 2) to the "mesh follows the hitbox centre" test. |

## Shared test scaffolding

Every task in `tests/player-bob.test.ts` uses this header. Write it once in Task 1; later tasks append `describe` blocks to the same file. It mirrors the helpers in `tests/player-feel.test.ts` so the suites read alike.

```typescript
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, TILE_SIZE, WALK_MAX } from '../src/physics/index.ts'
import type { TileGrid, TileKind } from '../src/physics/index.ts'
import {
  BOB_AMPLITUDE,
  BOB_FADE_RATE,
  BOB_MIN_SPEED,
  BOB_STRIDE,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  createPlayer,
  walkBobOffset,
} from '../src/entities/player/player.ts'
import type { Player, PlayerInput } from '../src/entities/player/index.ts'

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

function flatGround(width: number, height: number): TileGrid {
  const rows = Array.from({ length: height }, () => '.'.repeat(width))
  rows[height - 1] = '#'.repeat(width)
  return makeGrid(rows)
}

function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { jump: false, dash: false, moveX: 0, ...partial }
}

function stepFor(player: Player, frames: number, held: PlayerInput = input()): void {
  for (let i = 0; i < frames; i += 1) player.step(FIXED_DT, held)
}

function onGround(x = 2, mesh?: THREE.Object3D): Player {
  const player = createPlayer({ x, y: 1, grid: flatGround(64, 12), mesh })
  stepFor(player, 2)
  return player
}

/**
 * The bob, measured as the mesh's lift ABOVE the hitbox centre. Reading it this way is the
 * point: a bob that leaked into body.aabb would move the centre with the mesh and measure
 * zero here, so every assertion below is simultaneously an independence assertion.
 */
function bobLift(player: Player): number {
  return player.mesh.position.y - (player.body.aabb.y + PLAYER_HEIGHT / 2)
}
```

---

### Task 1: The bob curve and its constants

Adds the four tuning constants and the pure curve function, with no wiring into `step()` yet. Isolating the curve means its shape — non-negative, zero at phase 0, peaking at π — is pinned without running the simulation.

**Files:**
- Modify: `src/entities/player/player.ts` (add constants after `SQUASH_RECOVER_RATE` on line 51; add `walkBobOffset` after the `moveToward` helper)
- Create: `tests/player-bob.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BOB_AMPLITUDE: number` (0.06), `BOB_STRIDE: number` (1.6), `BOB_MIN_SPEED: number` (0.5), `BOB_FADE_RATE: number` (0.6), and `walkBobOffset(phase: number, amplitude: number): number`. Tasks 2–4 all import these.

- [ ] **Step 1: Write the failing test**

Create `tests/player-bob.test.ts` with the **Shared test scaffolding** block above, then append:

```typescript
describe('the walk bob curve', () => {
  test('is exactly zero at the bottom of the cycle', () => {
    // Phase 0 is where a walk starts and where it is parked when idle, so an offset here
    // would shift the resting mesh off the hitbox centre.
    expect(walkBobOffset(0, BOB_AMPLITUDE)).toBe(0)
    expect(walkBobOffset(2 * Math.PI, BOB_AMPLITUDE)).toBeCloseTo(0, 10)
  })

  test('peaks at the amplitude halfway through the cycle', () => {
    expect(walkBobOffset(Math.PI, BOB_AMPLITUDE)).toBeCloseTo(BOB_AMPLITUDE, 10)
  })

  test('never goes negative and never overshoots the amplitude', () => {
    // Non-negative is what keeps the shoes out of the floor: the character lifts off its
    // rest pose rather than sinking below it.
    for (let i = 0; i <= 400; i += 1) {
      const offset = walkBobOffset((i / 400) * 6 * Math.PI, BOB_AMPLITUDE)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(BOB_AMPLITUDE)
    }
  })

  test('a zero amplitude is flat at every phase', () => {
    for (const phase of [0, 0.7, Math.PI, 4.2, 2 * Math.PI]) {
      expect(walkBobOffset(phase, 0)).toBe(0)
    }
  })

  test('the tuning constants stay in Mario range', () => {
    // A bob taller than the hat reads as a pogo stick, and one below a pixel reads as nothing.
    expect(BOB_AMPLITUDE).toBeGreaterThan(0.02)
    expect(BOB_AMPLITUDE).toBeLessThan(0.12)
    expect(BOB_AMPLITUDE).toBeLessThan(PLAYER_HEIGHT / 10)
    // At WALK_MAX this is ~3.75 cycles/s — a brisk stride, not a vibration.
    expect(WALK_MAX / BOB_STRIDE).toBeGreaterThan(2)
    expect(WALK_MAX / BOB_STRIDE).toBeLessThan(6)
    // A full amplitude must fade in well under a fifth of a second or a jump pops.
    expect(BOB_AMPLITUDE / BOB_FADE_RATE).toBeLessThan(0.2)
    expect(BOB_MIN_SPEED).toBeGreaterThan(0)
    expect(BOB_MIN_SPEED).toBeLessThan(WALK_MAX / 4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player-bob.test.ts`
Expected: FAIL — the import of `BOB_AMPLITUDE` / `walkBobOffset` from `player.ts` cannot resolve (`No "walkBobOffset" export is defined`), so the whole file errors at collection.

- [ ] **Step 3: Write minimal implementation**

In `src/entities/player/player.ts`, after `SQUASH_RECOVER_RATE` (line 51), add:

```typescript
// The walk bob is decoration too, and on the same terms as squash and stretch: it moves
// mesh.position and nothing else. body.aabb never learns about it, so the hitbox a player
// collides with is identical mid-stride and standing still.
/** Peak bob lift in tiles at full walk speed — 4% of PLAYER_HEIGHT. */
export const BOB_AMPLITUDE = 0.06
/** Tiles of ground travel per full bob cycle. ~3.75 cycles/s at WALK_MAX. */
export const BOB_STRIDE = 1.6
/** Below this speed (tiles/s) the residual crawl friction leaves behind does not bob. */
export const BOB_MIN_SPEED = 0.5
/** Bob amplitude shed per second. A full amplitude fades out in 0.1 s. */
export const BOB_FADE_RATE = 0.6
```

Then, immediately after the `moveToward` helper (line 58), add:

```typescript
/**
 * The walk cycle's vertical curve, in tiles above the resting pose.
 *
 * `(1 - cos) / 2` rather than a plain sine for two reasons: it is non-negative, so the
 * character lifts off its rest pose on each step instead of sinking its shoes through the
 * floor, and it is exactly 0 at phase 0, so a walk starts from the bottom of the cycle and
 * a parked bob leaves the mesh precisely on the hitbox centre.
 */
export function walkBobOffset(phase: number, amplitude: number): number {
  return (amplitude * (1 - Math.cos(phase))) / 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player-bob.test.ts`
Expected: PASS (5 tests).

Then confirm nothing else moved: `npx vitest run` → 508 passing.

- [ ] **Step 5: Commit**

```bash
git add tests/player-bob.test.ts src/entities/player/player.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ash@users.noreply.local" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ash@users.noreply.local" \
git commit -m "T-042: the walk bob curve and its tuning constants"
```

---

### Task 2: Bob the mesh while grounded and walking

Wires the bob into `step()`. This is the task that makes the feature visible, and the task that forces the approved `tests/player.test.ts` amendment — so the amendment lands here, keeping the full suite green at every commit.

The implementation here is deliberately **minimal**: phase advances on a fixed clock and the amplitude is a flat constant. Task 3's tests are what drive it to distance-phasing and speed-scaling. Do not implement Task 3's behaviour early — you would rob its tests of their red.

**Files:**
- Modify: `src/entities/player/player.ts` (bob state in `createPlayer`; bob block + `mesh.position.set` inside `step`)
- Modify: `tests/player-bob.test.ts` (append)
- Modify: `tests/player.test.ts` (the single approved amendment)

**Interfaces:**
- Consumes: `BOB_AMPLITUDE`, `BOB_STRIDE`, `BOB_MIN_SPEED`, `BOB_FADE_RATE`, `walkBobOffset` from Task 1; the existing `moveToward` (`player.ts:54`) and the already-imported `WALK_MAX`.
- Produces: `mesh.position.y === body.aabb.y + PLAYER_HEIGHT / 2 + bob`, where `bob ∈ [0, BOB_AMPLITUDE]` and is bit-exactly `0` whenever the player is idle or airborne. Tasks 3 and 4 assert against this.

- [ ] **Step 1: Write the failing test**

Append to `tests/player-bob.test.ts`:

```typescript
describe('the bob is active only when grounded and walking', () => {
  const WALL = makeGrid([
    '................',
    '......#.........',
    '......#.........',
    '......#.........',
    '################',
  ])

  test('standing still parks the mesh bit-exactly on the hitbox centre', () => {
    const player = onGround()

    // Not toBeCloseTo: moveToward snaps, so a resting mesh must be EXACTLY centred. An
    // asymptotic decay would leave a crumb here and drift the art off the hitbox.
    for (let i = 0; i < 120; i += 1) {
      player.step(FIXED_DT, input())
      expect(bobLift(player)).toBe(0)
    }
  })

  test('walking lifts the mesh and oscillates', () => {
    const player = onGround()
    const lifts: number[] = []

    for (let i = 0; i < 180; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      lifts.push(bobLift(player))
    }

    // It rises...
    expect(Math.max(...lifts)).toBeGreaterThan(BOB_AMPLITUDE / 2)
    // ...and it comes back down, rather than parking at a constant offset.
    expect(Math.min(...lifts)).toBeLessThan(BOB_AMPLITUDE / 10)
    // Never below the rest pose and never above the cap.
    for (const lift of lifts) {
      expect(lift).toBeGreaterThanOrEqual(0)
      expect(lift).toBeLessThanOrEqual(BOB_AMPLITUDE)
    }
  })

  test('walking left bobs just like walking right', () => {
    const player = onGround()
    let peak = 0

    for (let i = 0; i < 180; i += 1) {
      player.step(FIXED_DT, input({ moveX: -1, left: true }))
      peak = Math.max(peak, bobLift(player))
    }

    expect(peak).toBeGreaterThan(BOB_AMPLITUDE / 2)
  })

  test('a jump taken mid-stride fades the bob out and stays exactly still in the air', () => {
    const player = onGround()
    const walking = input({ moveX: 1, right: true })
    stepFor(player, 60, walking)
    expect(bobLift(player)).toBeGreaterThan(0)

    const held = input({ moveX: 1, right: true, jump: true })
    player.step(FIXED_DT, held)
    expect(player.grounded).toBe(false)

    // A full amplitude sheds in BOB_AMPLITUDE / BOB_FADE_RATE seconds; allow a few frames
    // of slack, then demand a bit-exact zero for the whole rest of the airtime.
    const fadeFrames = Math.ceil(BOB_AMPLITUDE / BOB_FADE_RATE / FIXED_DT) + 3
    stepFor(player, fadeFrames, held)

    let airborneFrames = 0
    while (!player.grounded && airborneFrames < 600) {
      expect(bobLift(player)).toBe(0)
      player.step(FIXED_DT, held)
      airborneFrames += 1
    }
    expect(airborneFrames).toBeGreaterThan(10)
  })

  test('walking off a ledge stops bobbing instead of bouncing through the fall', () => {
    const LEDGE = makeGrid([
      '................',
      '................',
      '####............',
      '................',
      '################',
    ])
    const player = createPlayer({ x: 1, y: 3, grid: LEDGE })
    stepFor(player, 2)
    const walking = input({ moveX: 1, right: true })

    let sawFalling = false
    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, walking)
      if (!player.grounded && player.body.velocity.y < 0) {
        if (!sawFalling) {
          sawFalling = true
          stepFor(player, Math.ceil(BOB_AMPLITUDE / BOB_FADE_RATE / FIXED_DT) + 3, walking)
        }
        if (!player.grounded) expect(bobLift(player)).toBe(0)
      }
    }

    expect(sawFalling).toBe(true)
  })

  test('releasing the stick settles back to a bit-exact zero', () => {
    const player = onGround()
    stepFor(player, 60, input({ moveX: 1, right: true }))
    expect(bobLift(player)).toBeGreaterThan(0)

    // Friction takes ~18 frames to stop the player, then the amplitude fades.
    stepFor(player, 60)

    for (let i = 0; i < 120; i += 1) {
      player.step(FIXED_DT, input())
      expect(bobLift(player)).toBe(0)
    }
  })

  test('pushing into a wall stands still rather than bobbing on the spot', () => {
    const player = createPlayer({ x: 2, y: 1, grid: WALL })
    stepFor(player, 2)
    const pushing = input({ moveX: 1, right: true })

    // Walk into the wall; the sweep zeroes vx on contact.
    stepFor(player, 180, pushing)
    expect(player.grounded).toBe(true)
    expect(Math.abs(player.body.velocity.x)).toBeLessThan(BOB_MIN_SPEED)

    // Intent is still held. Gating on intent instead of speed would bob here forever.
    for (let i = 0; i < 60; i += 1) {
      player.step(FIXED_DT, pushing)
      expect(bobLift(player)).toBe(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player-bob.test.ts`
Expected: FAIL — "walking lifts the mesh and oscillates" fails with `expected 0 to be greater than 0.03`, because `step()` still parks the mesh flat on the hitbox centre. The idle/airborne/wall tests already pass (offset is always zero today); that is expected and fine — they are the invariants Task 2 must preserve.

- [ ] **Step 3: Write minimal implementation**

In `createPlayer`, alongside the other per-player state (after `let squash = 0`, line 191):

```typescript
  // Walk bob state. Phase is in radians and carries across frames; amplitude is what fades
  // the bob out on takeoff instead of popping it to zero mid-stride.
  let bobPhase = 0
  let bobAmp = 0
```

In `step`, insert a new block immediately after `updateCoyoteTimer(coyote, player.grounded, dt)` (line 240) and before the "7. Turn" comment:

```typescript
    // 6b. Walk bob. Gated on real speed, not intent: the sweep has already zeroed vx against
    // a wall, so pushing into one stands still instead of jogging on the spot. Read after the
    // sweep for the same reason.
    const speed = Math.abs(velocity.x)
    const bobbing = player.grounded && speed >= BOB_MIN_SPEED
    if (player.grounded) bobPhase += ((WALK_MAX * dt) / BOB_STRIDE) * 2 * Math.PI
    const targetAmp = bobbing ? BOB_AMPLITUDE : 0
    // moveToward snaps to its target, exactly as the squash recovery below does, so an idle
    // or airborne mesh settles on a bit-exact zero offset rather than an asymptotic crumb.
    bobAmp = moveToward(bobAmp, targetAmp, BOB_FADE_RATE * dt)
    // Park the phase with the amplitude so the next walk starts from the bottom of the cycle.
    if (bobAmp === 0) bobPhase = 0
    const bob = walkBobOffset(bobPhase, bobAmp)
```

Then change the existing `mesh.position.set` (line 246) — this is the **only** change to that line, and `body.aabb` is not touched:

```typescript
    mesh.position.set(
      body.aabb.x + PLAYER_WIDTH / 2,
      body.aabb.y + PLAYER_HEIGHT / 2 + bob,
      GAMEPLAY_Z,
    )
```

- [ ] **Step 4: Run test to verify it passes, then apply the approved amendment**

Run: `npx vitest run tests/player-bob.test.ts`
Expected: PASS (12 tests total in the file).

Now run the full suite: `npx vitest run`
Expected: **one** failure — `tests/player.test.ts > player hitbox > the mesh follows the hitbox centre`, because it walks 30 frames (0.925 tiles at `WALK_MAX`) and asserts `mesh.position.y` equals the AABB centre to 10 decimal places. This is the approved scope exception.

In `tests/player.test.ts`, add `BOB_AMPLITUDE` to the imports (a separate line, matching how `tests/player-feel.test.ts` reaches for `JUMP_STRETCH`; do not touch the existing `index.ts` import block):

```typescript
import { BOB_AMPLITUDE } from '../src/entities/player/player.ts'
```

Then replace **only** the `'the mesh follows the hitbox centre'` test (around line 310) with these two:

```typescript
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
    expect(lift).toBeLessThanOrEqual(BOB_AMPLITUDE)
  })
```

Leave every other test in `player.test.ts` untouched.

Run `npx vitest run` again.
Expected: all green, 516 passing.

- [ ] **Step 5: Commit**

```bash
git add src/entities/player/player.ts tests/player-bob.test.ts tests/player.test.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ash@users.noreply.local" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ash@users.noreply.local" \
git commit -m "T-042: bob the character mesh while it walks the ground"
```

---

### Task 3: Phase the bob on distance, and scale it with speed

Task 2 bobs at a fixed rate and a fixed height whatever the walk speed, so a slow walk skates through a full-speed cycle. This task makes the stride follow the ground.

**Files:**
- Modify: `src/entities/player/player.ts` (two expressions inside the Task 2 bob block)
- Modify: `tests/player-bob.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: bob phase advances by `distance / BOB_STRIDE` cycles; amplitude is `BOB_AMPLITUDE * min(1, speed / WALK_MAX)`. No new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/player-bob.test.ts`:

```typescript
describe('the bob is phased on distance, not on the clock', () => {
  /** Walk until `distance` tiles are covered, sampling the lift every frame. */
  function liftsOverDistance(distance: number, moveX: number): number[] {
    const player = onGround()
    const held = input({ moveX, right: moveX > 0, left: moveX < 0 })
    const startX = player.body.aabb.x
    const lifts: number[] = []

    for (let i = 0; i < 4000; i += 1) {
      player.step(FIXED_DT, held)
      lifts.push(bobLift(player))
      if (Math.abs(player.body.aabb.x - startX) >= distance) return lifts
    }
    throw new Error('player never covered the distance')
  }

  /** Strict local maxima — one per bob cycle. */
  function countPeaks(lifts: number[]): number {
    let peaks = 0
    for (let i = 1; i < lifts.length - 1; i += 1) {
      if (lifts[i]! > lifts[i - 1]! && lifts[i]! >= lifts[i + 1]!) peaks += 1
    }
    return peaks
  }

  test('the same ground covered is the same number of steps, whatever the speed', () => {
    // Three strides' worth of ground. A clock-phased bob would give the half-speed walk
    // twice as many cycles, because it spends twice as long covering the same tiles.
    const distance = 3 * BOB_STRIDE
    const full = countPeaks(liftsOverDistance(distance, 1))
    const half = countPeaks(liftsOverDistance(distance, 0.5))

    expect(full).toBe(3)
    expect(half).toBe(full)
  })

  test('a half-speed walk takes about twice as long to cover the same stride', () => {
    // Guards the premise of the test above: the two runs really are different in time.
    const distance = 3 * BOB_STRIDE
    const fullFrames = liftsOverDistance(distance, 1).length
    const halfFrames = liftsOverDistance(distance, 0.5).length

    expect(halfFrames / fullFrames).toBeGreaterThan(1.6)
  })

  test('a slower walk bobs lower', () => {
    const peakAt = (moveX: number): number => {
      const player = onGround()
      const held = input({ moveX, right: true })
      let peak = 0
      for (let i = 0; i < 300; i += 1) {
        player.step(FIXED_DT, held)
        peak = Math.max(peak, bobLift(player))
      }
      return peak
    }

    const full = peakAt(1)
    const half = peakAt(0.5)

    expect(full).toBeCloseTo(BOB_AMPLITUDE, 3)
    expect(half).toBeLessThan(full * 0.75)
    expect(half).toBeGreaterThan(0)
  })

  test('dashing does not lift the character any higher than a full walk', () => {
    // DASH_MAX is 1.6x WALK_MAX; the amplitude is clamped so dash feel stays out of T-042.
    const player = onGround()
    const held = input({ moveX: 1, right: true, dash: true })
    let peak = 0

    for (let i = 0; i < 300; i += 1) {
      player.step(FIXED_DT, held)
      peak = Math.max(peak, bobLift(player))
      expect(bobLift(player)).toBeLessThanOrEqual(BOB_AMPLITUDE)
    }

    expect(peak).toBeCloseTo(BOB_AMPLITUDE, 3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player-bob.test.ts`
Expected: FAIL on two tests —
- "the same ground covered is the same number of steps, whatever the speed": the half-speed run reports ~6 peaks against the full-speed run's 3.
- "a slower walk bobs lower": `half` equals `full` (both `BOB_AMPLITUDE`), so `expect(half).toBeLessThan(full * 0.75)` fails.

- [ ] **Step 3: Write minimal implementation**

In the Task 2 bob block in `src/entities/player/player.ts`, change exactly two expressions.

Phase — swap the fixed `WALK_MAX` clock for the distance actually covered:

```typescript
    // Advanced by DISTANCE travelled, not by time: a half-speed walk bobs at half the rate
    // instead of skating through a full-speed cycle with shorter steps.
    if (player.grounded) bobPhase += ((speed * dt) / BOB_STRIDE) * 2 * Math.PI
```

Amplitude — scale it with the walk, clamped so a dash does not lift higher:

```typescript
    const targetAmp = bobbing ? BOB_AMPLITUDE * Math.min(1, speed / WALK_MAX) : 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player-bob.test.ts`
Expected: PASS (16 tests).

Run: `npx vitest run`
Expected: all green, 520 passing.

- [ ] **Step 5: Commit**

```bash
git add src/entities/player/player.ts tests/player-bob.test.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ash@users.noreply.local" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ash@users.noreply.local" \
git commit -m "T-042: phase the bob on ground covered and scale it with the walk"
```

---

### Task 4: Guard rails — the bob stays out of the hitbox and out of the scale

These tests pin the invariants T-042 must never break: the bob is Y-position-only, it never feeds back into the simulation, and it composes with T-026 squash without either channel touching the other.

**These tests are expected to PASS on their first run** — they assert properties Tasks 2 and 3 already satisfy. A test that has never failed proves nothing, so Step 2 is a deliberate mutation check instead of a plain red run: you break the product code on purpose, watch each guard catch it, and revert. Do not skip it.

**Files:**
- Modify: `tests/player-bob.test.ts` (append)
- Modify: `src/entities/player/player.ts` (temporarily, during Step 2 only — reverted before Step 3)

**Interfaces:**
- Consumes: everything Tasks 1–3 produced. Adds no product code.

- [ ] **Step 1: Write the guard-rail tests**

Append to `tests/player-bob.test.ts`:

```typescript
describe('the bob is decoration and nothing else', () => {
  test('never touches the hitbox, through a long walking and jumping run', () => {
    const player = onGround()

    for (let i = 0; i < 600; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true, jump: i % 90 < 12 }))

      expect(player.body.aabb.w).toBe(PLAYER_WIDTH)
      expect(player.body.aabb.h).toBe(PLAYER_HEIGHT)
      // X is bit-exact on the centre: the bob is a Y-only offset.
      expect(player.mesh.position.x).toBe(player.body.aabb.x + PLAYER_WIDTH / 2)
      const lift = bobLift(player)
      expect(lift).toBeGreaterThanOrEqual(0)
      expect(lift).toBeLessThanOrEqual(BOB_AMPLITUDE)
    }
  })

  test('the simulation runs identically whether or not there is a mesh to bob', () => {
    // The strongest independence statement available: swap the real character for a bare
    // Object3D and the body must trace the SAME numbers, bit for bit. Any feedback from
    // mesh.position back into the sim would show up here as a divergence.
    const real = onGround()
    const stubbed = onGround(2, new THREE.Object3D())

    for (let i = 0; i < 400; i += 1) {
      const held = input({ moveX: i < 200 ? 1 : -1, right: i < 200, left: i >= 200, jump: i % 70 < 10 })
      real.step(FIXED_DT, held)
      stubbed.step(FIXED_DT, held)

      expect(stubbed.body.aabb.x).toBe(real.body.aabb.x)
      expect(stubbed.body.aabb.y).toBe(real.body.aabb.y)
      expect(stubbed.body.velocity.x).toBe(real.body.velocity.x)
      expect(stubbed.body.velocity.y).toBe(real.body.velocity.y)
      expect(stubbed.grounded).toBe(real.grounded)
    }
  })

  test('an injected stub mesh gets bobbed too', () => {
    const stub = new THREE.Object3D()
    const player = onGround(2, stub)
    expect(player.mesh).toBe(stub)

    let peak = 0
    for (let i = 0; i < 180; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      peak = Math.max(peak, bobLift(player))
    }

    expect(peak).toBeGreaterThan(BOB_AMPLITUDE / 2)
  })

  test('walking never touches the scale, which belongs to T-026', () => {
    const player = onGround()

    for (let i = 0; i < 240; i += 1) {
      player.step(FIXED_DT, input({ moveX: 1, right: true }))
      expect(player.mesh.scale.x).toBe(1)
      expect(player.mesh.scale.y).toBe(1)
      expect(player.mesh.scale.z).toBe(1)
    }
  })

  test('the landing squash and the bob run at once without either driving the other', () => {
    const player = onGround()
    const walking = input({ moveX: 1, right: true })
    stepFor(player, 40, walking)

    // Jump and hold the walk, so the landing is both squashed and moving.
    const jumping = input({ moveX: 1, right: true, jump: true })
    player.step(FIXED_DT, jumping)
    while (!player.grounded) player.step(FIXED_DT, jumping)
    expect(player.mesh.scale.y).toBeLessThan(1)

    // Within the squash recovery there is a frame where BOTH channels are live at once.
    let sawBoth = false
    for (let i = 0; i < 15; i += 1) {
      player.step(FIXED_DT, walking)
      if (player.mesh.scale.y < 1 && bobLift(player) > 0) sawBoth = true
    }
    expect(sawBoth).toBe(true)

    // And the squash still recovers to a bit-exact identity while the bob keeps going.
    stepFor(player, 60, walking)
    expect(player.mesh.scale.x).toBe(1)
    expect(player.mesh.scale.y).toBe(1)
    expect(player.mesh.scale.z).toBe(1)

    let peak = 0
    for (let i = 0; i < 120; i += 1) {
      player.step(FIXED_DT, walking)
      peak = Math.max(peak, bobLift(player))
      expect(player.mesh.scale.y).toBe(1)
    }
    expect(peak).toBeGreaterThan(BOB_AMPLITUDE / 2)
  })

  test('the T-033 character survives: still one merged, vertex-coloured mesh', () => {
    const player = onGround()
    stepFor(player, 60, input({ moveX: 1, right: true }))
    const mesh = player.mesh as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>

    expect(mesh).toBeInstanceOf(THREE.Mesh)
    expect(mesh.children).toHaveLength(0)
    expect(mesh.geometry).not.toBeInstanceOf(THREE.CapsuleGeometry)
    expect(mesh.geometry.getAttribute('color')).toBeDefined()
    expect(mesh.material.vertexColors).toBe(true)
  })
})
```

- [ ] **Step 2: Mutation check — prove each guard can fail**

Run them first to confirm they pass as written:

Run: `npx vitest run tests/player-bob.test.ts`
Expected: PASS (22 tests).

Now break the product code once per guard, run the suite, confirm the named test goes red, then **revert the mutation before the next one**. Apply each edit inside the Task 2 bob block in `src/entities/player/player.ts`.

| # | Temporary mutation | Test that must go red |
|---|---|---|
| 1 | Add `body.aabb.y += bob` just before `mesh.position.set` | "never touches the hitbox…" and "the simulation runs identically…" |
| 2 | Change the `mesh.position.set` X argument to `body.aabb.x + PLAYER_WIDTH / 2 + bob` | "never touches the hitbox…" |
| 3 | Add `mesh.scale.y += bob` as the last line of `step` | "walking never touches the scale…" |
| 4 | Change `const bob = ...` to `const bob = -walkBobOffset(bobPhase, bobAmp)` | "never touches the hitbox…" (lift goes negative) |

Run `npx vitest run tests/player-bob.test.ts` after each mutation, record which tests failed, then `git checkout -- src/entities/player/player.ts` to restore.

If any mutation leaves the suite green, that guard is not guarding anything — strengthen the test before moving on.

- [ ] **Step 3: Confirm the tree is clean and green**

```bash
git diff --stat src/entities/player/player.ts
```
Expected: **no output** — all four mutations reverted.

Run: `npx vitest run tests/player-bob.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 4: Full verification**

```bash
npx vitest run
npx tsc --noEmit
```
Expected: 526 tests passing across 35 files; `tsc` silent. The `THREE.WebGLRenderer: Error creating WebGL context.` stderr lines are pre-existing noise.

- [ ] **Step 5: Commit**

```bash
git add tests/player-bob.test.ts
GIT_AUTHOR_NAME="Ash Tilawat" GIT_AUTHOR_EMAIL="ash@users.noreply.local" \
GIT_COMMITTER_NAME="Ash Tilawat" GIT_COMMITTER_EMAIL="ash@users.noreply.local" \
git commit -m "T-042: guard rails pinning the bob out of the hitbox and the scale"
```

---

## Final Verification

Run from `/workspace/untitled-25d-platformer-walk-bob`:

```bash
npx vitest run                     # every suite, expect all green
npx tsc --noEmit                   # type check, expect silence
git status --short                 # expect clean; node_modules must NOT appear
git log --oneline origin/main..HEAD
```

The protected suites specifically:

```bash
npx vitest run tests/player-art.test.ts tests/player-feel.test.ts tests/player.test.ts tests/player-bob.test.ts
```

`tests/player-art.test.ts` and `tests/player-feel.test.ts` must be **unmodified** — confirm with:

```bash
git diff --stat origin/main..HEAD -- tests/player-art.test.ts tests/player-feel.test.ts
```
Expected: no output.

Optional visual check (not required by the ticket, no deploy): `npm run dev`, then walk — the character should bounce in stride, slower and lower at a gentle push — and stand or jump, where it should be perfectly still.

**Do not merge to main.** Stop after the last commit and report files changed, test results, and commit SHAs for code review.
