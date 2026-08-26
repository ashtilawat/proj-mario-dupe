# T-050 — boss art: the gray cube becomes a king

Branch `gfx/boss-art`. Scope lock: `src/entities/bosses/standin.ts` (mesh only) and the
mesh `describe` in `tests/boss.test.ts`. No other product file, and `main.ts` in
particular, is edited.

## Why

The 1-castle boss is the last gray box on screen. The player (T-033) and the walker
(T-030) both moved to procedural art built the same way — a table of flat-coloured boxes,
`paint()` per-vertex colours, `mergeGeometries`, one `MeshLambertMaterial({vertexColors:
true})`. The boss follows them and becomes a crowned king. The fight does not change: the
mesh has always been cosmetic and decoupled from the AABB.

## Invariants

- `BOSS_WIDTH = 3`, `BOSS_HEIGHT = 3`.
- `tryStomp`, `step`, `advanceState`, `driveAttack`, `resolveAttackEnd`, `enterIdle`,
  `enterTelegraph`, `enterAttack`, `setColor`, `syncMesh` bodies byte-identical.
- `boss.mesh` stays ONE `THREE.Mesh` with one geometry and one non-array material.
  `main.ts` disposes it as `mesh.geometry.dispose(); mesh.material.dispose()` in two
  places; children or a material array would leak straight past that.
- `mergeGeometries` keeps `useGroups` false, so `geometry.groups` stays empty — groups
  demand a material array.
- Hitbox, phase, stomp, determinism and module-surface tests unchanged.

## Steps

1. **Red.** Rewrite `describe('gray-box mesh')` in `tests/boss.test.ts` as
   `describe('king mesh')`, plus a `Part` interface and a `meshParts()` colour-partition
   helper directly above it (same helper `tests/player-art.test.ts` uses). Thirteen tests:
   one disposable Mesh; per-vertex colour attribute; seven colour parts and a
   `BufferGeometry`; silhouette on budget and centred; still ≥ 3 tiles wide and tall;
   hitbox constants untouched; royal palette by channel relation; crown band overhangs the
   head and the hem overhangs the robe; three separate crown points; every join overlaps;
   the jewel sits proud of the band; the telegraph tell. `follows the hitbox in world
   units as the fight plays out` is carried over byte-identical. Run: must fail.

2. **Green.** In `standin.ts`, above the class: a `BossPart` interface
   (`minX/maxX/minY/maxY/depth/zOffset?/color`), the `BOSS_PARTS` table, a local `paint()`
   (the module-surface test forbids importing from player/walker/enemies, and there is no
   shared art util), and `createKingGeometry()`. In the class: the mesh field type widens
   `BoxGeometry` → `BufferGeometry`, and the constructor builds the merged geometry with a
   `vertexColors: true` material tinted `BOSS_COLOR`.

3. **Palette.** `BOSS_COLOR` and `TELEGRAPH_COLOR` keep their names and every call site;
   only their values change, so no method body is touched. Lambert multiplies
   `material.color` by the vertex colour, so unlike the player and walker the boss cannot
   leave it white — `setColor` is the tell and white has no headroom to flash upward.
   `BOSS_COLOR` `0x7a7a7a` → `0xb3b3b3` (idle tint, ~70%), `TELEGRAPH_COLOR` `0xd6d6d6` →
   `0xffe6a3` (a warm gold flash: r ×1.43, g ×1.29 over idle).

4. **Verify.** Full `vitest run` and `tsc --noEmit`. Then `git diff` to confirm the test
   diff is only the mesh describe and its helper.

5. **Commit** on `gfx/boss-art`, subject starting `T-050`. No merge to main. Never stage
   the `node_modules` symlink.

## The parts table

Authored in tiles as local bounds around the mesh centre, multiplied by `TILE_SIZE` at
build time — `walker.ts` does the same, because `syncMesh` positions in world units.
`BOSS_MESH_WIDTH/HEIGHT/DEPTH` (3.5 / 3.25 / 1.5) keep their values and become the art's
silhouette budget, the way `MESH_SPAN_*` works for the player. `HALF_Y = 1.625`.

| part | X | Y | depth | colour |
|------|---|---|-------|--------|
| robe hem | ±1.75 | −1.625 → −0.60 | 1.50 | `0x3a2568` |
| robe torso | ±1.30 | −0.65 → 0.30 | 1.25 | `0x5b3a9e` |
| ermine collar | ±1.45 | 0.26 → 0.52 | 1.35 | `0xefe6d8` |
| head | ±0.75 | 0.48 → 1.10 | 1.05 | `0x6f9e4a` |
| crown band | ±0.90 | 1.05 → 1.35 | 1.20 | `0xd9a318` |
| crown point ×3 | −0.70…−0.46, ±0.12, 0.46…0.70 | 1.32 → 1.625 | 1.18 | `0xffd75e` |
| jewel | ±0.16 | 1.09 → 1.31 | 0.13 at z 0.615 | `0xd83c5e` |

Two wide-over-narrow steps carry the read: the hem flares out past the torso (a robe) and
the crown band overhangs the head (the same trick the player's hat brim uses). The points
are a brighter gold than the band so they are their own colour part and the 0.34-tile gaps
between them are testable, and they run 0.02 shallower than the band they overlap so no two
gold faces end up coplanar. Joins overlap 0.03–0.05 tiles, so no seam can open. The
silhouette lands exactly on budget — 3.5 × 3.25 × 1.5 — centred on the origin.

## Risks

- The mesh overhangs the 3×3 hitbox by 0.125 tiles top and bottom, exactly as the cube
  did. The hem sinking into the floor reads as a robe touching the ground.
- The idle tint is deliberately not white, which differs from the player and the walker.
  The king-mesh tests state why, so a later "make it consistent" edit fails loudly.
