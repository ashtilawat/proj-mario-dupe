import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { BG_Z, FRUSTUM_HEIGHT, GAMEPLAY_Z, createBackdrop } from '../src/render'

/**
 * Raw 0-255 channels straight off the hex, the way tests/palette.test.ts reads colours.
 * Going through the hex sidesteps three's sRGB-to-linear conversion of Color.r/g/b, so the
 * numbers asserted here are the numbers written in the source.
 */
function channels(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function isPbrMaterial(material: THREE.Material): boolean {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  )
}

function childrenOfKind(group: THREE.Object3D, kind: string): THREE.Mesh[] {
  return group.children.filter(isMesh).filter((mesh) => mesh.userData['kind'] === kind)
}

/**
 * The silhouette a mesh was cut from. Doubles as the "it is a flat paper cutout, not a
 * revolved solid" assertion, and dodges a cast: Mesh.geometry is typed as BufferGeometry,
 * which has no `parameters`.
 */
function shapeOf(mesh: THREE.Mesh): THREE.Shape {
  const { geometry } = mesh
  if (!(geometry instanceof THREE.ShapeGeometry)) {
    throw new Error(`expected ShapeGeometry on "${mesh.name}", got ${geometry.type}`)
  }
  const { shapes } = geometry.parameters
  const [shape] = Array.isArray(shapes) ? shapes : [shapes]
  if (shape === undefined) {
    throw new Error(`no shape on "${mesh.name}"`)
  }
  return shape
}

/**
 * The cutout's corner points, in traced order. A Shape of straight segments hands back its
 * own vertices at any divisions setting; the trailing repeat of the start point that
 * closePath leaves behind is dropped, so `length` is the corner count.
 */
function outlineOf(shape: THREE.Shape): THREE.Vector2[] {
  const points = shape.getPoints()
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length > 1 && first !== undefined && last !== undefined && last.equals(first)) {
    points.pop()
  }
  return points
}

/**
 * How many times a run of numbers reverses direction. A silhouette sampled off a circle
 * turns once — up to the crown, then down. A torn edge reverses over and over, and that
 * difference is the whole ticket: it is what separates a paper rip from a smooth dome.
 */
function directionChanges(values: number[]): number {
  let changes = 0
  let previous = 0
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index]
    const before = values[index - 1]
    if (current === undefined || before === undefined) continue
    const sign = Math.sign(current - before)
    if (sign === 0) continue
    if (previous !== 0 && sign !== previous) changes += 1
    previous = sign
  }
  return changes
}

function colorOf(mesh: THREE.Mesh): number {
  const [material] = materialsOf(mesh)
  if (!(material instanceof THREE.MeshLambertMaterial)) {
    throw new Error(`expected a MeshLambertMaterial on "${mesh.name}"`)
  }
  return material.color.getHex()
}

function worldZOf(mesh: THREE.Object3D): number {
  return mesh.getWorldPosition(new THREE.Vector3()).z
}

describe('createBackdrop', () => {
  test('is a Group parked on the background plane', () => {
    const backdrop = createBackdrop()

    expect(backdrop).toBeInstanceOf(THREE.Object3D)
    expect(backdrop).toBeInstanceOf(THREE.Group)
    expect(backdrop.name).toBe('backdrop')

    // BACKDROP_Z is duplicated inside backdrop.ts rather than imported, to avoid a cycle
    // with the re-export. This is the assertion that keeps the duplicate honest.
    expect(backdrop.position.z).toBe(BG_Z)
    expect(backdrop.position.z).toBe(-20)
    expect(backdrop.position.z).toBeLessThan(GAMEPLAY_Z)
  })

  test('returns a fresh group per call, so two scenes never share one', () => {
    const first = createBackdrop()
    const second = createBackdrop()

    expect(first).not.toBe(second)
    expect(first.children).toHaveLength(second.children.length)
  })

  test('cuts the same silhouettes every call: literal art, never generated', () => {
    const first = createBackdrop().children.filter(isMesh)
    const second = createBackdrop().children.filter(isMesh)

    for (let index = 0; index < first.length; index += 1) {
      const before = first[index]
      const after = second[index]
      if (before === undefined || after === undefined) throw new Error('mesh count drifted')

      // Math.random in here would show up as two different rips from one call to the next.
      expect(Array.from(outlineOf(shapeOf(after)).flatMap((p) => [p.x, p.y]))).toEqual(
        Array.from(outlineOf(shapeOf(before)).flatMap((p) => [p.x, p.y])),
      )
    }
  })
})

describe('backdrop hills', () => {
  test('are paper cutouts, not revolved domes', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    expect(hills.length).toBeGreaterThanOrEqual(2)

    for (const hill of hills) {
      // The thing this ticket kills. A hemisphere reads as a smooth blob, whatever colour
      // it is painted.
      expect(hill.geometry).not.toBeInstanceOf(THREE.SphereGeometry)
      expect(hill.geometry).toBeInstanceOf(THREE.ShapeGeometry)
    }
  })

  test('have a torn ridge, not a smooth crown or a flat trapezoid', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    for (const hill of hills) {
      const outline = outlineOf(shapeOf(hill))

      // Four corners would be a trapezoid; a rip needs somewhere to catch.
      expect(outline.length).toBeGreaterThanOrEqual(8)

      const ridge = outline.filter((point) => point.y > 0)
      expect(ridge.length).toBeGreaterThanOrEqual(6)
      // Notches, plural. One reversal is just a hilltop.
      expect(directionChanges(ridge.map((point) => point.y))).toBeGreaterThanOrEqual(3)
    }
  })

  test('are cut against a unit box, so position is the base line and scale is the span', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    for (const hill of hills) {
      const outline = outlineOf(shapeOf(hill))
      const xs = outline.map((point) => point.x)
      const ys = outline.map((point) => point.y)

      expect(Math.min(...xs)).toBeCloseTo(-1, 5)
      expect(Math.max(...xs)).toBeCloseTo(1, 5)
      // A flat bottom edge at local y = 0, exactly two corners wide. That is what lets the
      // overfill test below reason about the base line from position.y alone.
      expect(Math.min(...ys)).toBe(0)
      expect(outline.filter((point) => point.y === 0)).toHaveLength(2)
      // Peak at local y = 1, so scale.y is the hill's height.
      expect(Math.max(...ys)).toBeCloseTo(1, 5)
    }
  })

  test('are muted green, one tone per row', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    for (const hill of hills) {
      const { r, g, b } = channels(colorOf(hill))
      expect(g).toBeGreaterThan(r)
      expect(g).toBeGreaterThan(b)
    }

    expect(new Set(hills.map(colorOf)).size).toBe(2)
  })

  test('overfill the frustum, so no sky shows past or under the ridge', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    // Orthographic: no perspective shrink at BG_Z, so frustum units are world units.
    const halfWidth = (FRUSTUM_HEIGHT / 2) * (16 / 9)
    const floor = -FRUSTUM_HEIGHT / 2

    const left = Math.min(...hills.map((hill) => hill.position.x - hill.scale.x))
    const right = Math.max(...hills.map((hill) => hill.position.x + hill.scale.x))
    const highestBase = Math.max(...hills.map((hill) => hill.position.y))
    const highestRidge = Math.max(...hills.map((hill) => hill.position.y + hill.scale.y))

    expect(left).toBeLessThan(-halfWidth)
    expect(right).toBeGreaterThan(halfWidth)
    // Bases sit below the frustum floor, so a cutout never reveals its flat bottom edge.
    expect(highestBase).toBeLessThanOrEqual(floor)
    // And the ridge still clears the horizon it is drawn against.
    expect(highestRidge).toBeGreaterThan(0)
  })

  test('keep their nicks shallow, so the ridge stays a mound and not a mountain range', () => {
    for (const hill of childrenOfKind(createBackdrop(), 'hill')) {
      const outline = outlineOf(shapeOf(hill))

      // Read the roughness across the crown, where the mound is flat by construction, so what
      // is left is the tear itself rather than the hill's own curvature. A nick shows up here
      // as a corner sitting off the line between its two neighbours.
      const crown = outline
        .map((point, index) => ({ point, index }))
        .filter((corner) => corner.point.y > 0.85)

      expect(crown.length).toBeGreaterThanOrEqual(8)

      for (const { index } of crown) {
        const before = outline[index - 1]
        const after = outline[index + 1]
        const corner = outline[index]
        if (before === undefined || after === undefined || corner === undefined) continue

        // Nicks are a few percent of the hill's height. Wind them up to where they rival the
        // mound's own curvature and the silhouette stops reading as a hill — which is exactly
        // what an earlier pass at this ticket shipped. Without a ceiling here, nothing in this
        // file would notice that happening again: every other assertion about the tear only
        // asks whether it is there at all.
        expect(Math.abs(corner.y - (before.y + after.y) / 2)).toBeLessThan(0.05)
      }
    }
  })

  test('trace their ridge strictly left to right, so the outline never crosses itself', () => {
    for (const hill of childrenOfKind(createBackdrop(), 'hill')) {
      const xs = outlineOf(shapeOf(hill)).map((point) => point.x)

      // A nick that shoves its corner past its neighbour folds the outline into a bowtie.
      // Nothing downstream survives that: the triangulator shatters it into slivers, and the
      // skyline walk below silently reads the wrong segment.
      for (let index = 1; index < xs.length; index += 1) {
        expect(xs[index]).toBeGreaterThan(xs[index - 1] ?? Number.NEGATIVE_INFINITY)
      }
    }
  })

  test('close the skyline: no gap of sky opens where one hill hands off to the next', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')
    const halfWidth = (FRUSTUM_HEIGHT / 2) * (16 / 9)
    const floor = -FRUSTUM_HEIGHT / 2

    /**
     * The hill's upper boundary in world x/y. Its outline runs left base corner, ridge,
     * right base corner — increasing in x the whole way — so the traced points *are* the
     * top edge, and a bracketing pair is all an interpolation needs.
     */
    const topAt = (hill: THREE.Mesh, x: number): number => {
      const outline = outlineOf(shapeOf(hill)).map((point) => ({
        x: hill.position.x + hill.scale.x * point.x,
        y: hill.position.y + hill.scale.y * point.y,
      }))
      for (let index = 1; index < outline.length; index += 1) {
        const left = outline[index - 1]
        const right = outline[index]
        if (left === undefined || right === undefined) continue
        if (x < left.x || x > right.x) continue
        const span = right.x - left.x
        return span === 0 ? left.y : left.y + ((x - left.x) / span) * (right.y - left.y)
      }
      return Number.NEGATIVE_INFINITY
    }

    // As it stands the skyline clears the floor by some 4.7 units, with every column covered
    // by at least two hills — this cannot fail on today's numbers, and the nicks are far too
    // shallow to threaten it. It is here for the edit that moves, narrows or drops a hill:
    // that is a plausible art change, and it is the one that quietly opens sky under the
    // ridge. Sampled across the frustum rather than eyeballed for the same reason.
    for (let x = -halfWidth; x <= halfWidth; x += 0.05) {
      const skyline = Math.max(...hills.map((hill) => topAt(hill, x)))
      expect(skyline).toBeGreaterThan(floor)
    }
  })

  test('form two rows at distinct depths, all behind gameplay', () => {
    const backdrop = createBackdrop()
    backdrop.updateMatrixWorld(true)
    const hills = childrenOfKind(backdrop, 'hill')

    // Flat cutouts have no thickness to separate them, so no two may share a depth: coplanar
    // opaque paper z-fights wherever it overlaps.
    expect(new Set(hills.map((hill) => hill.position.z)).size).toBe(hills.length)

    // Two colours, two depth bands, and the bands do not interleave — that is what reads as
    // one row standing behind the other rather than as scattered clutter.
    const rows = new Map<number, number[]>()
    for (const hill of hills) {
      const color = colorOf(hill)
      rows.set(color, [...(rows.get(color) ?? []), hill.position.z])
    }
    expect(rows.size).toBe(2)
    const [firstRow, secondRow] = [...rows.values()]
    if (firstRow === undefined || secondRow === undefined) throw new Error('expected two rows')
    const back = Math.max(...firstRow) < Math.min(...secondRow) ? firstRow : secondRow
    const front = back === firstRow ? secondRow : firstRow
    expect(Math.max(...back)).toBeLessThan(Math.min(...front))

    for (const hill of hills) {
      for (const material of materialsOf(hill)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(hill)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('backdrop clouds', () => {
  test('are torn paper puffs, not smooth ellipsoids', () => {
    const clouds = childrenOfKind(createBackdrop(), 'cloud')

    expect(clouds.length).toBeGreaterThanOrEqual(2)

    for (const cloud of clouds) {
      expect(cloud.geometry).not.toBeInstanceOf(THREE.SphereGeometry)
      expect(cloud.geometry).toBeInstanceOf(THREE.ShapeGeometry)

      const outline = outlineOf(shapeOf(cloud))
      expect(outline.length).toBeGreaterThanOrEqual(8)

      // Same rip test as the hills, run over the puff's upper edge.
      const crown = outline.filter((point) => point.y > 0)
      expect(crown.length).toBeGreaterThanOrEqual(4)
      expect(directionChanges(crown.map((point) => point.y))).toBeGreaterThanOrEqual(3)

      // Cut around the origin against a unit box, so position is the puff's centre and
      // scale is its half-span.
      const xs = outline.map((point) => point.x)
      const ys = outline.map((point) => point.y)
      expect(Math.min(...xs)).toBeCloseTo(-1, 5)
      expect(Math.max(...xs)).toBeCloseTo(1, 5)
      expect(Math.min(...ys)).toBeCloseTo(-1, 5)
      expect(Math.max(...ys)).toBeCloseTo(1, 5)
    }
  })

  test('are torn at their ends too, not scissored off flat', () => {
    for (const cloud of childrenOfKind(createBackdrop(), 'cloud')) {
      const outline = outlineOf(shapeOf(cloud))

      let tallestEdge = 0
      for (let index = 0; index < outline.length; index += 1) {
        const from = outline[index]
        const to = outline[(index + 1) % outline.length]
        if (from === undefined || to === undefined) continue
        tallestEdge = Math.max(tallestEdge, Math.abs(to.y - from.y))
      }

      // The unit box is two tall. A puff whose columns stop short of its own lobes never cuts
      // the rounded tips, and closes the outline with one straight wall down each end instead
      // — half the cloud's height of dead-flat edge, which is scissors, not a tear. Every edge
      // of a torn outline is a nick's worth of drop, nowhere near that.
      expect(tallestEdge).toBeLessThan(0.6)
    }
  })

  test('are flattened cream, in open sky, in front of the hills', () => {
    const backdrop = createBackdrop()
    const clouds = childrenOfKind(backdrop, 'cloud')
    const hills = childrenOfKind(backdrop, 'hill')

    const frontmostHillZ = Math.max(...hills.map((hill) => hill.position.z))

    for (const cloud of clouds) {
      // Flattened, or it reads as a ball rather than a cloud.
      expect(cloud.scale.x).toBeGreaterThan(cloud.scale.y * 1.5)
      // Up in the sky half of the frame. A cloud can still overlap a hilltop below it —
      // CLOUD_LOCAL_Z keeps it in front, so that overlap depth-sorts rather than z-fights.
      expect(cloud.position.y).toBeGreaterThan(0)
      // In front of every hill, so an overlap depth-sorts instead of z-fighting.
      expect(cloud.position.z).toBeGreaterThan(frontmostHillZ)

      const { r, g, b } = channels(colorOf(cloud))
      expect(Math.min(r, g, b)).toBeGreaterThan(200)
    }
  })

  test('stay in Lambert and behind gameplay, like the rest of the layer', () => {
    const backdrop = createBackdrop()
    backdrop.updateMatrixWorld(true)

    for (const cloud of childrenOfKind(backdrop, 'cloud')) {
      for (const material of materialsOf(cloud)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(cloud)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('backdrop cost', () => {
  test('is a handful of meshes over shared materials', () => {
    const backdrop = createBackdrop()
    const meshes = backdrop.children.filter(isMesh)

    // Nothing but meshes hangs off the group: no stray lights, no nested groups.
    expect(meshes).toHaveLength(backdrop.children.length)
    expect(meshes.length).toBeLessThanOrEqual(12)

    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))

    // Every silhouette is torn its own way — a shared rip repeated across the ridge is the
    // pattern the eye catches — so geometry is per-mesh here rather than shared. Asserting the
    // count rather than a ceiling: `<= 8` would pass just as happily if every cutout went back
    // to sharing one buffer, which is the opposite of what this is here to pin down.
    expect(geometries.size).toBe(meshes.length)
    // Materials do still collapse, to one per hill row plus one for the clouds.
    expect(materials.size).toBeLessThanOrEqual(3)

    // What per-mesh geometry actually costs. Torn edges buy their detail in corners, so this
    // is the number that would run away if a later pass reached for finer nicks: the whole
    // layer has to stay a few hundred triangles, not a particle system.
    const triangles = meshes.reduce((total, mesh) => {
      const { index } = mesh.geometry
      const count =
        index === null ? mesh.geometry.getAttribute('position').count / 3 : index.count / 3
      return total + count
    }, 0)
    expect(triangles).toBeLessThanOrEqual(400)
  })

  test('triangulates every cutout as one simple polygon', () => {
    for (const mesh of createBackdrop().children.filter(isMesh)) {
      const corners = outlineOf(shapeOf(mesh)).length
      const { index } = mesh.geometry
      const triangles =
        index === null ? mesh.geometry.getAttribute('position').count / 3 : index.count / 3

      // A simple polygon of n corners fans out to exactly n - 2 triangles. Any other count
      // means the outline crossed itself somewhere and the triangulator did the best it could
      // with a bowtie — which on screen is a spray of slivers, not a silhouette.
      expect(triangles).toBe(corners - 2)
    }
  })

  test('carries no physics: this layer is visual only', () => {
    const backdrop = createBackdrop()

    expect('update' in backdrop).toBe(false)
    expect(backdrop.userData['aabb']).toBeUndefined()

    for (const child of backdrop.children) {
      expect(child.userData['aabb']).toBeUndefined()
    }
  })
})
