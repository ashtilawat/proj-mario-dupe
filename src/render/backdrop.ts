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
