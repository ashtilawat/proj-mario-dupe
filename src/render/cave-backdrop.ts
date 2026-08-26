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
