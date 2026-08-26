# T-060 — mushroom art (paper toadstool)

Branch `gfx/mushroom-art`. Design spec approved; this is the execution plan.

## Goal

Replace the T-030 two-`BoxGeometry` walker mushroom with a paper toadstool —
lathed bell cap, tapered cylindrical stem, five cream spots — without moving a
single gameplay number.

Scope is `createMushroomGeometry` in `src/entities/enemies/walker.ts` and the
local colour/size constants it needs, plus the mesh assertions in
`tests/walker.test.ts`. Nothing else.

## Steps

1. **Deps.** This worktree has no `node_modules`; `npm install` first.
2. **RED.** Rewrite `describe('mushroom mesh')` around a three-part toadstool
   and relax the two exact-fill pins in `describe('hitbox')`. Run and confirm
   the new assertions fail against today's two boxes.
3. **GREEN.** Rewrite `createMushroomGeometry` only:
   - cap: `LatheGeometry`, quarter-ellipse profile authored bottom-to-top,
     `CAP_RADIUS` 0.46, rim y 0.10, apex y 0.42, 20 radial segments, closed
     underside disc;
   - stem: `CylinderGeometry(0.15, 0.19, 0.64, 16)` centred at y = -0.18, foot
     at exactly -0.5 tiles, top overlapping the cap underside;
   - spots: 5 `CircleGeometry` discs from a literal
     `(azimuth, polar, radius)` table, oriented onto the cap's true ellipsoid
     normal via `Quaternion.setFromUnitVectors` and lifted `SPOT_LIFT` 0.012;
   - one `mergeGeometries([...])`, `useGroups` left false, sources disposed.
4. **Verify.** Full suite plus `tsc --noEmit`.
5. **Commit** on `gfx/mushroom-art`. No merge, no push.

## Invariants (a failure here is a bug, not a tradeoff)

- `walker.mesh` stays a `THREE.Mesh` with ONE `BufferGeometry` and ONE
  non-array `MeshLambertMaterial` — `main.ts` disposes both handles directly,
  so children or a material array would leak.
- `geometry.groups` stays empty (`useGroups: false`).
- Every vertex inside MESH_SPAN 1x1: local ±0.5 `TILE_SIZE` on x/y/z.
- The stem foot sits at exactly -0.5 `TILE_SIZE` — that is the walker's feet on
  the floor once `syncMesh` centres the mesh on a 1-tile AABB.
- `WALKER_WIDTH`/`WALKER_HEIGHT` stay 1; the AABB is still built from them.
- `step`, `turn`, `hasGroundAhead`, `tryStomp`, `syncMesh` bodies unchanged.
- Deterministic literals only. No `Math.random`. No `BoxGeometry`.

## Test plan

New/rewritten assertions in `tests/walker.test.ts`:

- three parts — red cap, cream stem, paler spots (replaces the 48-vertex and
  exactly-two-colours assertions)
- cap is rounded, not a box: ≥5 distinct horizontal radii, ≥8 distinct azimuths
- stem is a cylinder, not a box: ≥8 distinct azimuths about Y
- not two `BoxGeometry`s: `position.count` > 48
- spots sit on the cap: above the rim, below the apex, within the cap's width
- cap is not inside-out: topmost vertex normal has y > 0
- stays inside one tile, standing on its floor: every axis within
  ±0.5 `TILE_SIZE`; `box.min.y` ≈ -0.5 `TILE_SIZE`; `box.max.x` > 0.4 `TILE_SIZE`
- hitbox is not a copy of the mesh world bounds: exact `TILE_SIZE` pins dropped
  for ≥10x-the-AABB-and-≤`TILE_SIZE` bounds

Kept green and unedited: all `patrol`, all `stomp`, `createWalker`,
`module surface`, and within `mushroom mesh` the one-Mesh/single-Lambert/
no-groups test, the per-vertex-colour test, and the gameplay-plane sync test.
