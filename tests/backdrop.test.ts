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

/** Doubles as the "it is a SphereGeometry" assertion, and dodges a cast: Mesh.geometry is
 *  typed as BufferGeometry, which has no `parameters`. */
function sphereParams(mesh: THREE.Mesh): THREE.SphereGeometry['parameters'] {
  const { geometry } = mesh
  if (!(geometry instanceof THREE.SphereGeometry)) {
    throw new Error(`expected SphereGeometry on "${mesh.name}", got ${geometry.type}`)
  }
  return geometry.parameters
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
})

describe('backdrop hills', () => {
  test('are dome silhouettes in muted green', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    expect(hills.length).toBeGreaterThanOrEqual(2)

    for (const hill of hills) {
      const params = sphereParams(hill)

      // thetaLength stops the sweep at the equator: a dome with a flat bottom edge, not a
      // ball. That is what lets position.y be the base line and scale.y the height.
      expect(params.thetaLength).toBeCloseTo(Math.PI / 2, 5)
      // Cheap. A background silhouette does not need a smooth limb.
      expect(params.widthSegments).toBeLessThanOrEqual(16)

      const { r, g, b } = channels(colorOf(hill))
      expect(g).toBeGreaterThan(r)
      expect(g).toBeGreaterThan(b)
    }
  })

  test('overfill the frustum, so no sky shows past or under the ridge', () => {
    const hills = childrenOfKind(createBackdrop(), 'hill')

    // Orthographic: no perspective shrink at BG_Z, so frustum units are world units.
    const halfWidth = (FRUSTUM_HEIGHT / 2) * (16 / 9)
    const floor = -FRUSTUM_HEIGHT / 2

    const left = Math.min(...hills.map((hill) => hill.position.x - hill.scale.x))
    const right = Math.max(...hills.map((hill) => hill.position.x + hill.scale.x))
    const highestBase = Math.max(...hills.map((hill) => hill.position.y))

    expect(left).toBeLessThan(-halfWidth)
    expect(right).toBeGreaterThan(halfWidth)
    // Bases sit below the frustum floor, so the domes never reveal their flat bottom edge.
    expect(highestBase).toBeLessThanOrEqual(floor)
  })

  test('form two rows at distinct depths, all behind gameplay', () => {
    const backdrop = createBackdrop()
    backdrop.updateMatrixWorld(true)
    const hills = childrenOfKind(backdrop, 'hill')

    // Two rows, so overlapping opaque domes depth-sort instead of z-fighting.
    const depths = new Set(hills.map((hill) => hill.position.z))
    expect(depths.size).toBeGreaterThanOrEqual(2)

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
  test('are flattened cream ellipsoids in open sky, in front of the hills', () => {
    const backdrop = createBackdrop()
    const clouds = childrenOfKind(backdrop, 'cloud')
    const hills = childrenOfKind(backdrop, 'hill')

    expect(clouds.length).toBeGreaterThanOrEqual(2)

    const frontmostHillZ = Math.max(...hills.map((hill) => hill.position.z))

    for (const cloud of clouds) {
      const params = sphereParams(cloud)
      // A full sphere, unlike the hill domes — a cloud has no horizon to sit on.
      expect(params.thetaLength).toBeCloseTo(Math.PI, 5)
      expect(params.widthSegments).toBeLessThanOrEqual(16)

      // Flattened, or it reads as a ball rather than a cloud.
      expect(cloud.scale.x).toBeGreaterThan(cloud.scale.y * 1.5)
      // Up in open sky, clear of the far ridge line.
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
  test('is a handful of meshes over shared geometries and materials', () => {
    const backdrop = createBackdrop()
    const meshes = backdrop.children.filter(isMesh)

    // Nothing but meshes hangs off the group: no stray lights, no nested groups.
    expect(meshes).toHaveLength(backdrop.children.length)
    expect(meshes.length).toBeLessThanOrEqual(12)

    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))

    expect(geometries.size).toBeLessThanOrEqual(2)
    expect(materials.size).toBeLessThanOrEqual(3)
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
