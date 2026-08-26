# T-034 — Walker hitbox vs. mushroom mesh: implementation plan

Approved design: the gameplay AABB stays in TILE space at 1 x 1 and is never derived from
the cap mesh's world bounds. Pin that invariant with tests; change product code only if a
pin goes red.

## What the investigation found

The ticket's stated cause — the T-030 cap mesh enlarging the AABB — is not present in this
tree:

- `src/entities/enemies/walker.ts:131` is the only AABB construction site:
  `{ x: spawn.x, y: spawn.y, w: WALKER_WIDTH, h: WALKER_HEIGHT }`, both `1` tile.
- Nothing anywhere writes `aabb.w` / `aabb.h`; `sweepAabb` and `moveAndCollide` only write
  `x` / `y`.
- The mesh owns `MESH_SPAN` / `CAP_*` / `STEM_*` and is the only side multiplied by
  `TILE_SIZE`. `81f5215` split `MESH_SPAN` out of `WALKER_HEIGHT` for exactly this reason.
  Neither T-030 commit (`1db054b`, `81f5215`) touched a hitbox constant.
- The i-frame path in `main.ts` arms `invuln` inside the walker loop on the tick it bills
  the life, so no second walker and no later tick can double-bill.
- Patrol is `WALK_MAX / 3` = 2.0 tiles/s, so a walker passing straight through a standing
  player (0.7 wide) is in contact for `1.7 / 2.0 = 0.85 s` — inside the 1 s i-frame window,
  one life.

**But the symptom QA reported is real, and it is not the hitbox.** Measured on this branch
with an unmodified `walker.ts`, ticking the real game at 1/120 with the player standing
still and no input:

| player x | longest unbroken contact | lives billed at | final |
|---|---|---|---|
| 13.4 | 1.125 s | 0.950 s, 1.958 s, 9.983 s | 0 |
| 13.8 | 1.525 s | 0.750 s, 1.758 s, 9.783 s | 0 |
| 14.2 | 0.850 s | 0.550 s, 1.625 s, 9.583 s | 0 |
| 16.2 | — | 0.008 s, 2.625 s, 8.583 s | 0 |

At x = 13.8 **one unbroken contact bills two lives** (0.750 s and 1.758 s), and every
standing position reaches LIVES 0. The mechanism is the walker's ledge turn, not its size:
`hasGroundAhead` (`walker.ts:192-201`) looks a full tile ahead, so the leftward 1-1 walker
reverses at x ≈ 12.983 — and a player standing across that turn point never loses contact
while the walker goes in, turns, and comes back out. That is up to `2 x 1.7 = 3.4` tiles of
travel, ≈ 1.7 s, against an `invuln` (`main.ts:400-401`) that is a plain 1 s timer rather
than being scoped to the contact. x ≈ 13.3-14.7 is where the player lands after jumping the
pit, and the checkpoint is at x = 12, so this is the golden path.

The fix is in `main.ts`, which this ticket fences off, so it is reported back rather than
made here.

What is real is the coverage gap that let the ticket be written: **no test states the
walker's intended AABB size.** Every existing reference is relative (`aabb.x + aabb.w`) or
self-referential — `tests/walker.test.ts:345` positions the mesh *from* `aabb.w`, so it
holds for any width. The player has this pin (`tests/player-feel.test.ts:296-297`); the
walker does not. A gross 16x inflation would probably trip the patrol and ledge tests
sideways, by wedging the walker against geometry it no longer fits — but nothing would say
why, and a subtler inflation (a cap overhang folded into `h`, say) would pass clean.
Closing that is this ticket.

## Scope lock

| May change | Must not change |
|------------|-----------------|
| `tests/walker.test.ts` — one new `describe('hitbox')` block | every existing describe in that file |
| `tests/walker-spawn.test.ts` — one new sustained-contact test | every existing test in that file |
| `src/entities/enemies/walker.ts` — hitbox constants only, and only if a pin goes red | `tryStomp`, `step`, `patrol`, `hasGroundAhead`, `turn`, `syncMesh`, the mesh constants |
| — | `src/main.ts`, flag handling, every other product file |

## Task 1 — failing tests (red)

New `describe('hitbox')` in `tests/walker.test.ts`, after `mushroom mesh`. Each assertion
is written so an AABB taken from the mesh's world bounding box fails it:

1. **Absolute size in tiles** — `createWalker({x:16,y:1,dir:-1}).aabb` deep-equals
   `{ x:16, y:1, w:1, h:1 }`, and `w`/`h` are the exported `WALKER_WIDTH`/`WALKER_HEIGHT`.
2. **Not the mesh's world bounds** — compute `geometry.boundingBox`; assert
   `aabb.w !== boxWidth` and `aabb.h !== boxHeight`, while `aabb.w * TILE_SIZE === boxWidth`
   — the hitbox is that span expressed in *tiles*, never the raw world number.
3. **Not TILE_SIZE-scaled** — `aabb.w !== TILE_SIZE`, `aabb.h !== TILE_SIZE`.
4. **The cap adds no reach** — a player-sized probe AABB placed flush outside each face of
   the walker's tile (left, right, above) does not `overlap`; one placed inside does. This
   is "the cap mesh must not enlarge the AABB" stated in gameplay terms.
5. **Size survives patrol** — after 120 steps on each of the three grids (long floor, wall,
   ledge, so the turn branches are covered), `w`/`h` are still `1`/`1`.

Plus, in `tests/walker-spawn.test.ts`, the consequence of the size in the real game: stand
the player at x = 16.2 on the 1-1 floor, tick 1.5 s at 1/120, and assert the walker **walks
back out** — contact ends before 1 s — and that the bump billed one life. An AABB inflated
to the mesh's world bounds never stops overlapping, so contact never ends and the i-frame
window reopens.

The window is 1.5 s on purpose in both directions: shorter would not outlast the i-frames,
longer would catch the walker's legitimate second pass at ~2.6 s. The test does not assert
"one contact always bills one life" — as measured above, that is not true of the shipped
game at the pit-rim turn point, and fixing it means editing `main.ts`.

**Proving they can fail.** These pins guard code that is already correct, so they are green
on first run. Before trusting them, reproduce the bug the ticket describes — at
`walker.ts:131`, `w: CAP_WIDTH * TILE_SIZE, h: MESH_SPAN * TILE_SIZE` — and confirm every
new assertion goes red. Then revert and re-run.

## Task 2 — implementation (green)

Expected: **no product change.** `WALKER_WIDTH = 1` and `WALKER_HEIGHT = 1` already satisfy
every pin. Touch `src/entities/enemies/walker.ts` only if a pin is red.

## Task 3 — verify

- `npm ci` — this worktree has no `node_modules`.
- `npx vitest run tests/walker.test.ts tests/walker-spawn.test.ts` — new pins green.
- `npx vitest run` — full suite, no regressions.
- The mutation run above, red then reverted.
- `npm run typecheck`.
- `git diff` — tests only; no `src/` change, no `main.ts`.
- Commit on `fix/walker-hitbox`. Do not merge.

## Report back to the factory

**QA's symptom reproduces; QA's stated cause does not.** T-034 closes the hitbox question
and leaves the defect open, because the defect is in `main.ts`.

Follow-up ticket, on `main.ts`: bill at most one life per *unbroken* overlap with a given
walker — a per-walker "already billed while still touching" latch — instead of a 1 s timer
the pit-rim turn geometry can outlast. Contact-scoped is the correct shape here; raising
`HIT_IFRAMES_S` only moves the threshold, since the contact length depends on where the
player stands relative to the turn point. That block also still carries the known T-019
`prevVy == 0` stomp edge case, so the two are worth fixing together.

Also unpinned: acceptance criterion 2, "player can jump past the walker and touch the 1-1
flag," has no end-to-end test — `tests/game-flow-advance.test.ts` teleports the player to
the flag rather than traversing. Out of scope here; naming it so nobody reads this ticket
as having verified it.
