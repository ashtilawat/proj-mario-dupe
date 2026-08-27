import * as THREE from 'three'

/**
 * Sky backdrop: hill silhouettes under a few clouds, parked on the background plane.
 *
 * Visual only — no physics body, no AABB, no per-frame update.
 *
 * main.ts builds this once for the whole run and shows it on grass levels only — hills and
 * clouds have no business standing behind a castle, and none at all underground. It lifts the
 * group to CAMERA_Y there; everything below is written in the group's own frame, where the
 * camera sits at y = 0.
 *
 * Everything here is cut, not modelled. Each hill and each cloud is one closed outline of
 * straight segments — a torn paper edge — triangulated flat by ShapeGeometry, the same way
 * ./castle-backdrop.ts cuts its arches. Two things do the work. The mass stays round, because
 * a hill that zigzags from base to crown stops being a hill and starts being a mountain range.
 * The edge along that mass is nicked, because a rounded mass with a clean edge is a balloon.
 * Torn paper is a round shape with a rough boundary, and it is the boundary that has to carry
 * it: a revolved solid shades across its limb, and that soft gradient is what stopped the old
 * hemispheres from ever reading as paper, whatever colour they were painted.
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

/** A corner of a cutout, in the unit box its silhouette is traced against. */
interface Corner {
  x: number
  y: number
}

/**
 * The rip: a fixed run of nicks, each between -1 and 1, scaled to a real depth by whoever
 * reads it. Every cutout starts at a different offset into the run, so no two edges tear alike
 * while the art stays one literal line instead of a hand-placed corner per nick. Twenty-three
 * of them, an odd length that lines up with no cutout's corner count, so the run does not
 * print the same few centimetres of edge over and over down a ridge.
 *
 * Literal, never generated: Math.random has no place here, for the same reason it has none in
 * tile-art.ts — the art has to come out identical on every call so it can be asserted.
 */
const TEAR_PATTERN: readonly number[] = [
  0.45, -0.7, 1, -0.28, 0.66, -0.9, 0.34, -0.55, 0.93, -1, 0.5, -0.33, 0.78, -0.66, 0.22, -0.85,
  0.6, -0.42, 0.88, -0.24, 0.38, -0.76, 0.7,
]

function tearAt(index: number, offset: number): number {
  // Wrapped the long way round on purpose: JavaScript's % keeps the sign of its left operand,
  // so a negative offset would index past the start of the run, come back undefined, and tear
  // nothing at all — a silhouette silently missing its rip rather than an error.
  const length = TEAR_PATTERN.length
  return TEAR_PATTERN[(((index + offset) % length) + length) % length] ?? 0
}

/** One closed outline, corner by corner, in the order given. */
function traceShape(outline: readonly Corner[]): THREE.Shape {
  const shape = new THREE.Shape()
  outline.forEach((corner, index) => {
    if (index === 0) {
      shape.moveTo(corner.x, corner.y)
    } else {
      shape.lineTo(corner.x, corner.y)
    }
  })
  shape.closePath()
  return shape
}

/**
 * How deep a nick bites, in world units — the same depth on every cutout, because a rip does
 * not know how big the thing it tears is. Both builders below divide it down into their own
 * unit box, so a short near hill is torn no more coarsely than the tall far one behind it.
 *
 * This is the number that decides whether the layer reads as paper or as scenery, and it only
 * works against a corner count fine enough to carry it: a rip is fine detail on a smooth mass,
 * so the nicks have to be much smaller than the mound's own curvature. Make them comparable
 * and the mound stops being a mound. Earlier passes at this ticket put nicks four times this
 * deep across a sixth as many corners, and the screenshots came back with a mountain range.
 */
const TEAR_DEPTH = 0.1

/**
 * How much of a nick also displaces its corner sideways, as a fraction of the gap to the next
 * corner. A tear that only ever moves up and down combs itself into even teeth; shifting the
 * corners along the edge too is what keeps the spacing uneven.
 *
 * Under 0.5 by necessity, not by taste: two neighbours nudged the full amount towards each
 * other close the gap by twice this, and at 0.5 or over they cross. A crossed outline is a
 * bowtie, and a bowtie triangulates into a spray of slivers across the sky — which is what
 * this constant, set as a fraction of the wrong quantity, did on its first outing.
 */
const SIDEWAYS_TEAR = 0.35

/** Read the sideways nick from a different part of the pattern than the vertical one, so the
 *  two do not move together and print a regular scallop. */
const SIDEWAYS_TEAR_SHIFT = 5

/** Corners along a hill's ridge. Enough that a nick is a nick rather than a facet of the
 *  mound; few enough that the whole layer stays a few hundred triangles. */
const RIDGE_SAMPLES = 45

/**
 * How full the mound sits under its crown, as the exponent on a unit arch. At 0.5 this is
 * exactly the circle the old hemispheres drew; under it the shoulders carry more of the mass
 * and the crown flattens off, which is the difference between a hill cut out of paper and a
 * ball. Over it the shoulders fall away and the thing turns into a mountain — which is what a
 * first pass at this ticket shipped, and what the screenshots caught.
 */
const HILL_SHOULDER = 0.385

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

/**
 * How far each cutout steps forward from the one before it in its row. Paper has no thickness
 * to separate coplanar sheets, so two overlapping cutouts sharing a depth would z-fight down
 * the whole overlap. A sliver each settles the order, and stays an order of magnitude under
 * the gap between the two rows so the rows still read as rows.
 */
const PAPER_STEP_Z = 0.02

/** Hill bases sit below the frustum floor (y = -5), so no sky shows under the ridge and a
 *  cutout never reveals the flat edge it was cut off at. */
const HILL_BASE_Y = -6

interface HillSpec {
  x: number
  halfWidth: number
  height: number
  far: boolean
  /**
   * Where the crown leans. 0 is a symmetric mound; positive walks the summit left, negative
   * right. Every hill leans a different way — a row of centred mounds reads as a pattern.
   */
  crownShift: number
  /** Where this hill starts reading TEAR_PATTERN, so its edge is nobody else's. */
  tearOffset: number
}

/**
 * The far row tops out around y = 2.2; the near row peaks below it, which is what makes the
 * two read as depth rather than as clutter. Spans overlap horizontally so the ridge line is
 * unbroken across the frustum, and reach past x = ±8.9 (the 16:9 frustum edge) so a later
 * parallax pass can slide the layer without exposing an edge. Where one hill hands off to the
 * next, the neighbour is still high enough that no wedge of sky opens under the skyline —
 * `tests/backdrop.test.ts` samples across the whole frustum rather than trusting the eye.
 */
const HILLS: readonly HillSpec[] = [
  { x: -9, halfWidth: 6.5, height: 8.2, far: true, crownShift: -0.18, tearOffset: 0 },
  { x: -0.5, halfWidth: 5, height: 8.2, far: true, crownShift: 0.14, tearOffset: 3 },
  { x: 8.5, halfWidth: 7, height: 8.4, far: true, crownShift: -0.1, tearOffset: 6 },
  { x: -5.5, halfWidth: 5, height: 5.6, far: false, crownShift: 0.16, tearOffset: 9 },
  { x: 3.5, halfWidth: 5.8, height: 5.9, far: false, crownShift: -0.13, tearOffset: 12 },
]

/**
 * A hill cutout: flat base edge from (-1, 0) to (1, 0), torn ridge over the top.
 *
 * The unit box is the contract the rest of the module leans on — position.y is the hill's base
 * line, scale.x its half-span, scale.y its height, exactly as it was when these were scaled
 * hemispheres. Dividing the ridge through by its own summit is what keeps the second half of
 * that true once the nicks have moved the summit around.
 */
function createTornHillShape(spec: HillSpec): THREE.Shape {
  const ridge: Corner[] = []
  for (let index = 0; index < RIDGE_SAMPLES; index += 1) {
    // Corners spaced by angle rather than evenly along x, so they bunch up at the flanks where
    // the mound turns hardest. Evenly spaced corners spend themselves on the flat crown and
    // leave the shoulders to be crossed by one long chord, which is a facet, not a hill.
    const angle = (Math.PI * (index + 1)) / (RIDGE_SAMPLES + 1)
    const step = -Math.cos(angle)
    // How far this corner sits from the next one. Angular spacing is widest at the crown and
    // closes to nothing at the base corners, so a nudge measured against it stays in
    // proportion the whole way along instead of swamping the flanks.
    const spacing = (Math.PI / (RIDGE_SAMPLES + 1)) * Math.sin(angle)
    const x = step + tearAt(index, spec.tearOffset + SIDEWAYS_TEAR_SHIFT) * SIDEWAYS_TEAR * spacing
    // Leaning the crown warps x before the arch is read off it. The pull dies out at ±1, so
    // the mound still meets its base corners however far the summit has walked.
    const leaned = x + spec.crownShift * (1 - x * x)
    const mound = (1 - leaned * leaned) ** HILL_SHOULDER
    // A positive nick bites into the mound, a negative one leaves a spur standing off it.
    ridge.push({ x, y: mound - tearAt(index, spec.tearOffset) * (TEAR_DEPTH / spec.height) })
  }

  const summit = Math.max(...ridge.map((corner) => corner.y))
  return traceShape([
    { x: -1, y: 0 },
    ...ridge.map((corner) => ({ x: corner.x, y: corner.y / summit })),
    { x: 1, y: 0 },
  ])
}

/** Warm cream rather than pure white, so clouds read as lit instead of as holes in the sky. */
const CLOUD_COLOR = 0xf4f1e4

/** Clouds ride in front of both hill rows. */
const CLOUD_LOCAL_Z = 0.5

/** Corners along each of a cloud's two edges, crown and underside. */
const CLOUD_SAMPLES = 18

/** The underside reads from further along TEAR_PATTERN than the crown, so a puff is not nicked
 *  symmetrically top and bottom the way a folded cut-out would be. */
const UNDERSIDE_TEAR_SHIFT = 7

/** One rounded lobe of a cloud: centre and radius on each axis, in the cloud's own box. */
interface Lump {
  x: number
  halfWidth: number
  y: number
  halfHeight: number
}

interface CloudSpec {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
  /**
   * The lobes the puff is massed from, overlapping so their union is one connected shape. Three
   * of them, unequal: the tall one off centre is what stops a cloud reading as a row of scallops.
   */
  lumps: readonly Lump[]
  /** Where this cloud starts reading TEAR_PATTERN. */
  tearOffset: number
}

/** Three puffs, unevenly spaced and unevenly sized — a regular rhythm would read as a
 *  pattern. One cutout each, not a cluster of meshes: the cheapest thing that still reads. */
const CLOUDS: readonly CloudSpec[] = [
  {
    x: -6.5,
    y: 3.2,
    halfWidth: 2.4,
    halfHeight: 0.85,
    lumps: [
      { x: -0.58, halfWidth: 0.46, y: -0.02, halfHeight: 0.6 },
      { x: 0, halfWidth: 0.58, y: 0.1, halfHeight: 0.86 },
      { x: 0.56, halfWidth: 0.5, y: -0.06, halfHeight: 0.64 },
    ],
    tearOffset: 2,
  },
  {
    x: 1.5,
    y: 4,
    halfWidth: 1.8,
    halfHeight: 0.7,
    lumps: [
      { x: -0.52, halfWidth: 0.52, y: 0, halfHeight: 0.56 },
      { x: 0.06, halfWidth: 0.54, y: 0.14, halfHeight: 0.84 },
      { x: 0.6, halfWidth: 0.46, y: -0.04, halfHeight: 0.6 },
    ],
    tearOffset: 7,
  },
  {
    x: 7.5,
    y: 2.6,
    halfWidth: 2.8,
    halfHeight: 0.95,
    lumps: [
      { x: -0.62, halfWidth: 0.48, y: -0.04, halfHeight: 0.58 },
      { x: -0.06, halfWidth: 0.56, y: 0.12, halfHeight: 0.88 },
      { x: 0.58, halfWidth: 0.52, y: -0.02, halfHeight: 0.66 },
    ],
    tearOffset: 11,
  },
]

/**
 * A cloud cutout: the union of its lobes, walked as one closed outline — the underside left to
 * right, then the crown back right to left — and nicked along both.
 *
 * Sampling the union per column rather than tracing lobe outlines is what leaves the seams
 * between lobes as soft valleys instead of as the crossing arcs of overlapping ellipses, which
 * is the difference between a puff and a chain of circles.
 */
function createTornCloudShape(spec: CloudSpec): THREE.Shape {
  const crown: Corner[] = []
  const underside: Corner[] = []

  // Sweep the lobes' own span, not the unit box. Stopping short of the outermost lobe leaves
  // its rounded tip uncut, and the outline then closes across the gap with one straight wall
  // down each end — roughly half the puff's height of dead-flat edge, which is a scissor cut.
  const reachLeft = Math.min(...spec.lumps.map((lump) => lump.x - lump.halfWidth))
  const reachRight = Math.max(...spec.lumps.map((lump) => lump.x + lump.halfWidth))

  const reachMiddle = (reachLeft + reachRight) / 2
  const reachHalf = (reachRight - reachLeft) / 2

  for (let index = 0; index < CLOUD_SAMPLES; index += 1) {
    // Columns spaced by angle, bunching at the tips, for the reason the ridge does the same:
    // a lobe stands vertically where it ends, so evenly spaced columns miss the turn entirely
    // and the first one already lands a third of the way up the side.
    const x =
      reachMiddle - reachHalf * Math.cos((Math.PI * (index + 1)) / (CLOUD_SAMPLES + 1))
    let high = Number.NEGATIVE_INFINITY
    let low = Number.POSITIVE_INFINITY
    for (const lump of spec.lumps) {
      const reach = 1 - ((x - lump.x) / lump.halfWidth) ** 2
      if (reach <= 0) continue
      const half = lump.halfHeight * Math.sqrt(reach)
      high = Math.max(high, lump.y + half)
      low = Math.min(low, lump.y - half)
    }
    // The lobes are laid out to overlap, so every column lands inside at least one of them.
    // A column that fell through a gap would have no edge to nick, and is simply skipped.
    if (high === Number.NEGATIVE_INFINITY) continue
    // A nick is a fraction of the paper it bites, and at the tips there is barely any paper:
    // the crown and the underside meet there. Tapering the nick with the column's own depth is
    // what keeps the two edges from crossing where they converge — a crown corner nicked below
    // the underside beneath it folds the outline, and a folded outline triangulates to slivers.
    // Capped at a quarter of the depth, so the two nicks together can never eat more than half
    // of it and the edges always keep clear water between them.
    const depth = high - low
    const bite = Math.min(TEAR_DEPTH / spec.halfHeight, depth / 4)
    crown.push({ x, y: high + tearAt(index, spec.tearOffset) * bite })
    underside.push({
      x,
      y: low - tearAt(index, spec.tearOffset + UNDERSIDE_TEAR_SHIFT) * bite,
    })
  }

  // Stretched out to the unit box on each axis, so position is the puff's centre and scale its
  // half-span. Sideways it is a shift and a stretch, not a bare divide: a puff whose lobes
  // hang further one way than the other would otherwise come out off-centre in its own box,
  // and position.x would stop being the middle of the cloud.
  const columns = crown.map((corner) => corner.x)
  const middle = (Math.min(...columns) + Math.max(...columns)) / 2
  const spanX = (Math.max(...columns) - Math.min(...columns)) / 2
  // Crown and underside take their own factor: lobes massed above the centre line would
  // otherwise leave the box half empty underneath, and scale.y would be a half-height that no
  // part of the cloud actually reaches. Safe only because every crown corner sits above the
  // centre line and every underside corner below it — which the tapered nick above guarantees,
  // and which is what stops the two edges swapping places when they are scaled apart.
  const spanUp = Math.max(...crown.map((corner) => corner.y))
  const spanDown = Math.max(...underside.map((corner) => -corner.y))

  // Underside left to right, then the crown back right to left: one closed loop.
  return traceShape([
    ...underside.map((corner) => ({ x: (corner.x - middle) / spanX, y: corner.y / spanDown })),
    ...crown
      .map((corner) => ({ x: (corner.x - middle) / spanX, y: corner.y / spanUp }))
      .reverse(),
  ])
}

/** Hills and clouds for the background plane. A fresh group every call — two scenes must
 *  never share one object. */
export function createBackdrop(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'backdrop'
  group.position.z = BACKDROP_Z

  const farHillMaterial = new THREE.MeshLambertMaterial({ color: HILL_FAR_COLOR })
  const nearHillMaterial = new THREE.MeshLambertMaterial({ color: HILL_NEAR_COLOR })

  // Materials are shared down each row; geometry is not, because every cutout is torn its own
  // way and a rip repeated along the ridge is the one thing the eye does catch. Each is a
  // couple of dozen triangles off a literal outline, so the layer stays a handful of small
  // buffers rather than anything that wants batching.
  //
  // Rank is position in HILLS within a row, and it decides which cutout laps over which where
  // two of them cross — so the order of that array is an art decision, not just a list.
  let farRank = 0
  let nearRank = 0
  for (const hill of HILLS) {
    const geometry = new THREE.ShapeGeometry(createTornHillShape(hill))
    const mesh = new THREE.Mesh(geometry, hill.far ? farHillMaterial : nearHillMaterial)
    mesh.name = 'hill'
    mesh.userData['kind'] = 'hill'
    const rank = hill.far ? farRank++ : nearRank++
    const rowZ = hill.far ? FAR_HILL_Z : NEAR_HILL_Z
    mesh.position.set(hill.x, HILL_BASE_Y, rowZ + rank * PAPER_STEP_Z)
    // Flat by construction: a ShapeGeometry has no depth to squash, which is the point.
    mesh.scale.set(hill.halfWidth, hill.height, 1)
    group.add(mesh)
  }

  const cloudMaterial = new THREE.MeshLambertMaterial({ color: CLOUD_COLOR })

  CLOUDS.forEach((cloud, rank) => {
    const geometry = new THREE.ShapeGeometry(createTornCloudShape(cloud))
    const mesh = new THREE.Mesh(geometry, cloudMaterial)
    mesh.name = 'cloud'
    mesh.userData['kind'] = 'cloud'
    mesh.position.set(cloud.x, cloud.y, CLOUD_LOCAL_Z + rank * PAPER_STEP_Z)
    mesh.scale.set(cloud.halfWidth, cloud.halfHeight, 1)
    group.add(mesh)
  })

  return group
}
