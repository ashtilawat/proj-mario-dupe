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

/** Hills and clouds for the background plane. A fresh group every call — two scenes must
 *  never share one object. */
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
}
