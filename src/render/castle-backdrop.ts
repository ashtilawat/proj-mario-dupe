import * as THREE from 'three'

/**
 * Castle backdrop: an arcade of pillars and arches standing against a great hall wall, parked
 * on the background plane. The third member of the set beside the sky hills in ./backdrop.ts
 * and the cave rock in ./cave-backdrop.ts, in the same paper-cut language — flat literals,
 * cheap Lambert, silhouettes that read at a glance.
 *
 * Visual only — no physics body, no AABB, no per-frame update.
 *
 * NOT WIRED TO ANYTHING ON SCREEN yet. Nothing calls this: `createRenderScene` still paints its
 * background with a flat instanced tile layer, and main.ts never asks for it. Hanging it behind
 * a castle level is a later ticket.
 *
 * The camera is orthographic (see FRUSTUM_HEIGHT in ./index.ts), so nothing here shrinks with
 * distance — geometry at CASTLE_BACKDROP_Z draws at true world size, and frustum units are
 * world units. Everything below is sized against the frustum directly: y spans [-5, 5], x
 * spans ±8.9 at 16:9.
 *
 * What makes this a castle rather than recoloured hills or a recoloured cave is that the
 * silhouettes are cut, not swelled. A hill and a cave dome are both filled masses; an arch is
 * a mass with a hole under it. The eye reads the void the arcade leaves as *interior*, and no
 * amount of repainting a dome row gets that.
 */

/**
 * Depth of the layer. Mirrors `BG_Z` in ./index.ts, deliberately duplicated rather than
 * imported: index.ts re-exports this module, so importing back from it would close a cycle.
 * `tests/castle-backdrop.test.ts` asserts the two stay equal.
 */
const CASTLE_BACKDROP_Z = -20

/** The hall wall behind everything, deepest in shadow and the darkest tone in the layer. */
const WALL_COLOR = 0x5a5048

/** Muted brick, for the banners hung down the wall. The one warm accent, and the only thing
 *  here that is cloth rather than stone. */
const BANNER_COLOR = 0x9c5544

/** Dusty stone for the far arcade — lifted off the wall behind it, but still in the gloom. */
const FAR_STONE_COLOR = 0x8a7c69

/** Pale dusty cream for the near arcade, the brightest stone and the closest to the eye. */
const NEAR_STONE_COLOR = 0xb5a48c

/**
 * All four are warm: red leads and blue trails in every one. That single ordering is what
 * keeps this layer clear of its neighbours for good — the hills (0x4a7f6d, 0x3f6b47) lead with
 * green, the cave (0x2e3757, 0x212845) leads with blue. They are also all paler than either
 * cave tone, because this is a lit interior and not a hole in the ground. Both of those modules
 * keep their own copies of their hexes; this one imports no palette, by scope.
 *
 * The four tones brighten in step with depth — wall, then banners, then far arcade, then near.
 * Nothing deeper is ever lighter than something in front of it, so the rows sort themselves by
 * tone alone, before a single silhouette overlaps.
 */

/**
 * Local Z offsets: small enough to keep every mesh inside the background band, large enough to
 * give overlapping opaque silhouettes a real depth order instead of z-fighting.
 */
const WALL_Z = -0.9
const BANNER_Z = -0.8
const FAR_ARCADE_Z = -0.6
const NEAR_ARCADE_Z = -0.3

/** The floor the pillars stand on, below the frustum bottom (y = -5) so no pillar ever shows
 *  the flat cut edge at its foot. */
const FLOOR_Y = -5.5

/** Springlines: the height each row's arches lift off their pillars. The far row springs
 *  higher and the near row lower, so the far arcade's crowns clear the near one instead of
 *  hiding behind it — the only depth cue an orthographic camera will give for free. */
const FAR_SPRING_Y = 1.4
const NEAR_SPRING_Y = 0.2

/** Flattening applied to every solid silhouette's depth. The layer is read head-on, so
 *  thickness is wasted geometry — it needs just enough not to look like cut cardboard. */
const SILHOUETTE_DEPTH = 0.35

/** Flat cuts — wall, banners, arches — have no thickness at all. */
const PAPER_DEPTH = 1

/** Wall span. Overfills the 16:9 frustum (±8.9 by ±5) on all four sides, so a later parallax
 *  pass can slide the layer without opening a gap at an edge. */
const WALL_WIDTH = 20
const WALL_HEIGHT = 12

interface PillarSpec {
  x: number
  width: number
  far: boolean
}

/**
 * Two rows of pillars, four back and three front. The near ones are fatter and stop lower;
 * every near pillar is set well off the x of every far one, so the front row never stands
 * dead in front of the back row and erase it.
 *
 * Literal, never generated: Math.random has no place here, for the same reason it has none in
 * backdrop.ts or cave-backdrop.ts — the art has to come out identical on every call so it can
 * be asserted.
 */
const PILLARS: readonly PillarSpec[] = [
  { x: -7.5, width: 0.64, far: true },
  { x: -2.5, width: 0.64, far: true },
  { x: 2.5, width: 0.64, far: true },
  { x: 7.5, width: 0.64, far: true },
  { x: -5, width: 1.1, far: false },
  { x: 0.6, width: 1.1, far: false },
  { x: 6.2, width: 1.1, far: false },
]

interface ArchSpec {
  /** Centres of the two pillars this arch spans. Its own x and half-span fall out of them, so
   *  a bay can never drift off its supports. */
  from: number
  to: number
  rise: number
  far: boolean
}

/** One arch per adjacent pair of pillars in each row, which is what turns two rows of posts
 *  into two arcades. The near arches are wider and lower than the far ones. */
const ARCHES: readonly ArchSpec[] = [
  { from: -7.5, to: -2.5, rise: 1.4, far: true },
  { from: -2.5, to: 2.5, rise: 1.4, far: true },
  { from: 2.5, to: 7.5, rise: 1.4, far: true },
  { from: -5, to: 0.6, rise: 2, far: false },
  { from: 0.6, to: 6.2, rise: 2, far: false },
]

interface BannerSpec {
  x: number
  y: number
  width: number
  height: number
}

/** Two banners, hung at different heights and off-centre — a matched pair either side of the
 *  middle would read as a menu screen rather than as a room. */
const BANNERS: readonly BannerSpec[] = [
  { x: -4.2, y: 2.4, width: 1, height: 2.4 },
  { x: 3, y: 3, width: 0.86, height: 2 },
]

/** Inner radius of the arch band, as a fraction of the outer. The stone between the two arcs;
 *  the disc inside it is the archway, and cutting it is the whole point of this layer. */
const ARCH_INNER_RADIUS = 0.68

/** How far the arch's legs drop below the springline, so the band overlaps the pillar tops it
 *  lands on instead of meeting them on a seam. */
const ARCH_SKIRT = 0.14

/** Curve resolution. Cheap: a background silhouette does not need a smooth intrados. */
const ARCH_SEGMENTS = 12

/**
 * A unit arch band: outer radius 1, springline at local y = 0, open beneath the arc. Traced as
 * one closed outline — out along the extrados left to right, down the right leg, back along the
 * intrados right to left, down the left leg — which leaves the archway as absent geometry
 * rather than as a hole that has to be triangulated against the boundary it touches.
 *
 * Unit radius is what makes scale.x the arch's half-span and scale.y its rise, the same trick
 * the hills and the cave domes play with their hemispheres.
 */
function createArchShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-1, -ARCH_SKIRT)
  // absarc draws the leg up to the arc's start point for us, then sweeps over the top.
  shape.absarc(0, 0, 1, Math.PI, 0, true)
  shape.lineTo(1, -ARCH_SKIRT)
  shape.lineTo(ARCH_INNER_RADIUS, -ARCH_SKIRT)
  shape.absarc(0, 0, ARCH_INNER_RADIUS, 0, Math.PI, false)
  shape.lineTo(-ARCH_INNER_RADIUS, -ARCH_SKIRT)
  shape.closePath()
  return shape
}

/** Flat quad, used for the wall and the banners. Unit-sized, so scale is the span. */
function createPaperGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1)
}

/** Unit box: scale.x is the pillar's full width and scale.y its full height. */
function createPillarGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(1, 1, 1)
}

/** A castle hall's wall, banners and arcades for the background plane. A fresh group every
 *  call — two scenes must never share one object. */
export function createCastleBackdrop(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'castle-backdrop'
  group.position.z = CASTLE_BACKDROP_Z

  const paperGeometry = createPaperGeometry()

  const wall = new THREE.Mesh(
    paperGeometry,
    new THREE.MeshLambertMaterial({ color: WALL_COLOR }),
  )
  wall.name = 'wall'
  wall.userData['kind'] = 'wall'
  wall.position.set(0, 0, WALL_Z)
  wall.scale.set(WALL_WIDTH, WALL_HEIGHT, PAPER_DEPTH)
  group.add(wall)

  const bannerMaterial = new THREE.MeshLambertMaterial({ color: BANNER_COLOR })
  for (const banner of BANNERS) {
    const mesh = new THREE.Mesh(paperGeometry, bannerMaterial)
    mesh.name = 'banner'
    mesh.userData['kind'] = 'banner'
    mesh.position.set(banner.x, banner.y, BANNER_Z)
    mesh.scale.set(banner.width, banner.height, PAPER_DEPTH)
    group.add(mesh)
  }

  const farStoneMaterial = new THREE.MeshLambertMaterial({ color: FAR_STONE_COLOR })
  const nearStoneMaterial = new THREE.MeshLambertMaterial({ color: NEAR_STONE_COLOR })

  const pillarGeometry = createPillarGeometry()
  for (const pillar of PILLARS) {
    const top = pillar.far ? FAR_SPRING_Y : NEAR_SPRING_Y
    const mesh = new THREE.Mesh(pillarGeometry, pillar.far ? farStoneMaterial : nearStoneMaterial)
    mesh.name = 'pillar'
    mesh.userData['kind'] = 'pillar'
    // Centre of a shaft running from the off-screen floor up to its row's springline.
    mesh.position.set(pillar.x, (FLOOR_Y + top) / 2, pillar.far ? FAR_ARCADE_Z : NEAR_ARCADE_Z)
    mesh.scale.set(pillar.width, top - FLOOR_Y, SILHOUETTE_DEPTH)
    group.add(mesh)
  }

  const archGeometry = new THREE.ShapeGeometry(createArchShape(), ARCH_SEGMENTS)
  for (const arch of ARCHES) {
    const mesh = new THREE.Mesh(archGeometry, arch.far ? farStoneMaterial : nearStoneMaterial)
    mesh.name = 'arch'
    mesh.userData['kind'] = 'arch'
    mesh.position.set(
      (arch.from + arch.to) / 2,
      arch.far ? FAR_SPRING_Y : NEAR_SPRING_Y,
      arch.far ? FAR_ARCADE_Z : NEAR_ARCADE_Z,
    )
    mesh.scale.set((arch.to - arch.from) / 2, arch.rise, PAPER_DEPTH)
    group.add(mesh)
  }

  return group
}
