/**
 * T-054 — the cave backdrop, in isolation.
 *
 * Nothing hangs this on screen yet (that is T-055), so everything here is asserted straight off
 * the factory. The sky backdrop it sits beside is covered by tests/backdrop.test.ts and is only
 * touched here to prove the two are different things.
 */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { BG_Z, FRUSTUM_HEIGHT, GAMEPLAY_Z, createBackdrop } from '../src/render'
import { createCaveBackdrop } from '../src/render/cave-backdrop.ts'

/**
 * Raw 0-255 channels straight off the hex, the way tests/backdrop.test.ts reads colours.
 * Going through the hex sidesteps three's sRGB-to-linear conversion of Color.r/g/b, so the
 * numbers asserted here are the numbers written in the source.
 */
function channels(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

function luma(hex: number): number {
  const { r, g, b } = channels(hex)
  return r + g + b
}

/**
 * The hexes backdrop.ts paints its hills in and the underground void hex from tile-art.ts,
 * copied rather than imported: the first two are module-private there, and this ticket does not
 * reach into tile-art.ts. They are here as the two things the cave palette is measured against —
 * darker and less green than the hills, but clear of the void.
 */
const HILL_HEXES = [0x4a7f6d, 0x3f6b47] as const
const VOID_HEX = 0x0a0e1a

/** Turned-over meshes carry this on rotation.z: PI about Z hangs a dome and points a cone down. */
const UPSIDE_DOWN = Math.PI

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

function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  return group.children.filter(isMesh)
}

function childrenOfKind(group: THREE.Object3D, kind: string): THREE.Mesh[] {
  return meshesOf(group).filter((mesh) => mesh.userData['kind'] === kind)
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

function coneParams(mesh: THREE.Mesh): THREE.ConeGeometry['parameters'] {
  const { geometry } = mesh
  if (!(geometry instanceof THREE.ConeGeometry)) {
    throw new Error(`expected ConeGeometry on "${mesh.name}", got ${geometry.type}`)
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

/** A dome's reach: its base line plus the height it was scaled to. Signed, so a ceiling dome
 *  (turned over) reports how far down it hangs. */
function domeReach(mesh: THREE.Mesh): number {
  return mesh.position.y + (mesh.rotation.z === 0 ? mesh.scale.y : -mesh.scale.y)
}

describe('createCaveBackdrop', () => {
  test('is a Group parked on the background plane', () => {
    const cave = createCaveBackdrop()

    expect(cave).toBeInstanceOf(THREE.Object3D)
    expect(cave).toBeInstanceOf(THREE.Group)
    expect(cave.name).toBe('cave-backdrop')
    // 'backdrop' belongs to createBackdrop and to the live wiring that looks it up by name.
    expect(cave.name).not.toBe('backdrop')

    // CAVE_BACKDROP_Z is duplicated inside cave-backdrop.ts rather than imported, to avoid a
    // cycle with the re-export. This is the assertion that keeps the duplicate honest.
    expect(cave.position.z).toBe(BG_Z)
    expect(cave.position.z).toBe(-20)
    expect(cave.position.z).toBeLessThan(GAMEPLAY_Z)
  })

  test('returns a fresh group per call, so two scenes never share one', () => {
    const first = createCaveBackdrop()
    const second = createCaveBackdrop()

    expect(first).not.toBe(second)
    expect(first.children).toHaveLength(second.children.length)
  })

  test('is its own factory, not an alias of the sky backdrop', () => {
    expect(createCaveBackdrop).not.toBe(createBackdrop)

    const cave = createCaveBackdrop()
    expect(cave.name).not.toBe(createBackdrop().name)
    // No hills, no clouds: those kinds belong to the sky layer.
    expect(childrenOfKind(cave, 'hill')).toHaveLength(0)
    expect(childrenOfKind(cave, 'cloud')).toHaveLength(0)
    for (const mesh of meshesOf(cave)) {
      expect(['cave-wall', 'stalactite', 'stalagmite']).toContain(mesh.userData['kind'])
    }
  })
})

describe('cave walls', () => {
  test('are domes closing in from the ceiling and from the floor', () => {
    const walls = childrenOfKind(createCaveBackdrop(), 'cave-wall')
    const floor = walls.filter((wall) => wall.rotation.z === 0)
    const ceiling = walls.filter((wall) => wall.rotation.z !== 0)
    const halfHeight = FRUSTUM_HEIGHT / 2

    expect(floor.length).toBeGreaterThanOrEqual(2)
    expect(ceiling.length).toBeGreaterThanOrEqual(2)

    for (const wall of walls) {
      const params = sphereParams(wall)
      // thetaLength stops the sweep at the equator: a dome with a flat cut edge, not a ball.
      // That is what lets position.y be the base line and scale.y the reach.
      expect(params.thetaLength).toBeCloseTo(Math.PI / 2, 5)
      // Cheap. A background silhouette does not need a smooth limb.
      expect(params.widthSegments).toBeLessThanOrEqual(16)
    }

    // Bases sit outside the frustum, so no dome ever reveals its flat cut edge.
    for (const wall of floor) {
      expect(wall.position.y).toBeLessThanOrEqual(-halfHeight)
    }
    for (const wall of ceiling) {
      // PI about Z turns the dome over and leaves depth alone.
      expect(wall.rotation.z).toBeCloseTo(UPSIDE_DOWN, 5)
      expect(wall.position.y).toBeGreaterThanOrEqual(halfHeight)
    }
  })

  test('leave a corridor of void across the middle of the frame', () => {
    const walls = childrenOfKind(createCaveBackdrop(), 'cave-wall')
    const floorTop = Math.max(
      ...walls.filter((wall) => wall.rotation.z === 0).map(domeReach),
    )
    const ceilingUnderside = Math.min(
      ...walls.filter((wall) => wall.rotation.z !== 0).map(domeReach),
    )

    // Rock from both sides, never meeting: this is what makes it a cave and not a hill row.
    expect(floorTop).toBeLessThan(0)
    expect(ceilingUnderside).toBeGreaterThan(0)
    expect(ceilingUnderside).toBeGreaterThan(floorTop)
  })

  test('overfill the frustum, so no void shows past either edge', () => {
    const walls = childrenOfKind(createCaveBackdrop(), 'cave-wall')
    // Orthographic: no perspective shrink at BG_Z, so frustum units are world units.
    const halfWidth = (FRUSTUM_HEIGHT / 2) * (16 / 9)

    for (const row of [
      walls.filter((wall) => wall.rotation.z === 0),
      walls.filter((wall) => wall.rotation.z !== 0),
    ]) {
      const left = Math.min(...row.map((wall) => wall.position.x - wall.scale.x))
      const right = Math.max(...row.map((wall) => wall.position.x + wall.scale.x))
      expect(left).toBeLessThan(-halfWidth)
      expect(right).toBeGreaterThan(halfWidth)
    }
  })

  test('form two rows at distinct depths, all behind gameplay', () => {
    const cave = createCaveBackdrop()
    cave.updateMatrixWorld(true)
    const walls = childrenOfKind(cave, 'cave-wall')

    // Two rows, so overlapping opaque domes depth-sort instead of z-fighting.
    const depths = new Set(walls.map((wall) => wall.position.z))
    expect(depths.size).toBeGreaterThanOrEqual(2)

    for (const wall of walls) {
      for (const material of materialsOf(wall)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(wall)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('cave formations', () => {
  test('hang from the ceiling and rise from the floor, rooted in rock', () => {
    const cave = createCaveBackdrop()
    const stalactites = childrenOfKind(cave, 'stalactite')
    const stalagmites = childrenOfKind(cave, 'stalagmite')
    // Quarter of the frustum: past this from the middle you are inside the rock mass.
    const insideRock = FRUSTUM_HEIGHT / 4
    const offScreen = FRUSTUM_HEIGHT / 2

    expect(stalactites.length).toBeGreaterThanOrEqual(1)
    expect(stalagmites.length).toBeGreaterThanOrEqual(1)

    for (const spike of [...stalactites, ...stalagmites]) {
      const params = coneParams(spike)
      // Cheap facets, not a turned column.
      expect(params.radialSegments).toBeLessThanOrEqual(8)
    }

    for (const spike of stalactites) {
      // Turned over, so the apex points down into the void.
      expect(spike.rotation.z).toBeCloseTo(UPSIDE_DOWN, 5)
      const root = spike.position.y + spike.scale.y / 2
      const tip = spike.position.y - spike.scale.y / 2
      expect(root).toBeGreaterThan(insideRock)
      expect(tip).toBeLessThan(insideRock)
      expect(tip).toBeGreaterThan(-offScreen)
    }

    for (const spike of stalagmites) {
      expect(spike.rotation.z).toBe(0)
      const root = spike.position.y - spike.scale.y / 2
      const tip = spike.position.y + spike.scale.y / 2
      expect(root).toBeLessThan(-insideRock)
      expect(tip).toBeGreaterThan(-insideRock)
      expect(tip).toBeLessThan(offScreen)
    }
  })

  test('ride in front of both rock rows, and stay behind gameplay', () => {
    const cave = createCaveBackdrop()
    cave.updateMatrixWorld(true)
    const frontmostWallZ = Math.max(
      ...childrenOfKind(cave, 'cave-wall').map((wall) => wall.position.z),
    )
    const spikes = [...childrenOfKind(cave, 'stalactite'), ...childrenOfKind(cave, 'stalagmite')]

    for (const spike of spikes) {
      // In front of every dome, so an overlap depth-sorts instead of z-fighting.
      expect(spike.position.z).toBeGreaterThan(frontmostWallZ)

      for (const material of materialsOf(spike)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }

      const worldZ = worldZOf(spike)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })
})

describe('cave palette', () => {
  test('is cool dark rock, never the grass-hill greens', () => {
    const dullestHill = Math.min(...HILL_HEXES.map(luma))
    const palestHillGreen = Math.min(...HILL_HEXES.map((hex) => channels(hex).g))

    for (const mesh of meshesOf(createCaveBackdrop())) {
      const { r, g, b } = channels(colorOf(mesh))

      // Blue-dominant slate. Green never leads, so this can never drift back to the hills.
      expect(b).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(r)
      // Darker than either hill row, and with less green in it than either.
      expect(luma(colorOf(mesh))).toBeLessThan(dullestHill)
      expect(g).toBeLessThan(palestHillGreen)
    }
  })

  test('clears the underground void, so the silhouettes still read against it', () => {
    const voidChannels = channels(VOID_HEX)

    for (const mesh of meshesOf(createCaveBackdrop())) {
      const { r, g, b } = channels(colorOf(mesh))

      // Near-black on near-black is not a silhouette. Every channel stands off the void.
      expect(r).toBeGreaterThanOrEqual(voidChannels.r + 20)
      expect(g).toBeGreaterThanOrEqual(voidChannels.g + 20)
      expect(b).toBeGreaterThanOrEqual(voidChannels.b + 20)
    }
  })
})

describe('cave backdrop cost', () => {
  test('is a handful of meshes over shared geometries and materials', () => {
    const cave = createCaveBackdrop()
    const meshes = meshesOf(cave)

    // Nothing but meshes hangs off the group: no stray lights, no nested groups.
    expect(meshes).toHaveLength(cave.children.length)
    expect(meshes.length).toBeLessThanOrEqual(12)

    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))

    expect(geometries.size).toBeLessThanOrEqual(2)
    expect(materials.size).toBeLessThanOrEqual(3)
  })

  test('carries no physics: this layer is visual only', () => {
    const cave = createCaveBackdrop()

    expect('update' in cave).toBe(false)
    expect(cave.userData['aabb']).toBeUndefined()

    for (const child of cave.children) {
      expect(child.userData['aabb']).toBeUndefined()
    }
  })
})
