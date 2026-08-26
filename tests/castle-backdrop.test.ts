/**
 * T-061 — the castle backdrop, in isolation.
 *
 * Nothing hangs this on screen (that is a later ticket), so everything here is asserted
 * straight off the factory. The sky hills and the cave rock it sits beside have their own
 * suites; they are touched here only to prove all three are different things.
 */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  BG_Z,
  FRUSTUM_HEIGHT,
  GAMEPLAY_Z,
  createBackdrop,
  createCaveBackdrop,
  createRenderScene,
  createCastleBackdrop as createCastleBackdropFromIndex,
} from '../src/render'
import { createCastleBackdrop } from '../src/render/castle-backdrop.ts'

/**
 * Raw 0-255 channels straight off the hex, the way tests/cave-backdrop.test.ts reads colours.
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
 * The hill hexes from backdrop.ts and the cave hexes from cave-backdrop.ts, copied rather than
 * imported: they are module-private there, and this ticket does not reach into either file.
 * They are here as the two palettes the castle must never be mistaken for.
 */
const HILL_HEXES = [0x4a7f6d, 0x3f6b47] as const
const CAVE_HEXES = [0x2e3757, 0x212845] as const

/** Half the 16:9 frustum width. Orthographic, so frustum units are world units at BG_Z. */
const HALF_WIDTH = (FRUSTUM_HEIGHT / 2) * (16 / 9)
const HALF_HEIGHT = FRUSTUM_HEIGHT / 2

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

/** Doubles as the "it is a ShapeGeometry" assertion, and dodges a cast: Mesh.geometry is
 *  typed as BufferGeometry, which has no `parameters`. */
function shapeParams(mesh: THREE.Mesh): THREE.ShapeGeometry['parameters'] {
  const { geometry } = mesh
  if (!(geometry instanceof THREE.ShapeGeometry)) {
    throw new Error(`expected ShapeGeometry on "${mesh.name}", got ${geometry.type}`)
  }
  return geometry.parameters
}

/** Distance of every vertex from the arch's local origin — the springline centre. The arc
 *  band lives between the inner and outer radius; a filled dome would reach the centre. */
function archRadii(mesh: THREE.Mesh, aboveSpringlineOnly = true): number[] {
  const position = mesh.geometry.getAttribute('position')
  const radii: number[] = []
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    if (aboveSpringlineOnly && y < 0) continue
    radii.push(Math.hypot(x, y))
  }
  return radii
}

function topOf(mesh: THREE.Mesh): number {
  return mesh.position.y + mesh.scale.y / 2
}

function bottomOf(mesh: THREE.Mesh): number {
  return mesh.position.y - mesh.scale.y / 2
}

describe('createCastleBackdrop', () => {
  test('is a Group parked on the background plane', () => {
    const castle = createCastleBackdrop()

    expect(castle).toBeInstanceOf(THREE.Object3D)
    expect(castle).toBeInstanceOf(THREE.Group)
    expect(castle.name).toBe('castle-backdrop')
    // 'backdrop' belongs to createBackdrop and to the live wiring that looks it up by name.
    expect(castle.name).not.toBe('backdrop')
    expect(castle.name).not.toBe('cave-backdrop')

    // CASTLE_BACKDROP_Z is duplicated inside castle-backdrop.ts rather than imported, to avoid
    // a cycle with the re-export. This is the assertion that keeps the duplicate honest.
    expect(castle.position.z).toBe(BG_Z)
    expect(castle.position.z).toBe(-20)
    expect(castle.position.z).toBeLessThan(GAMEPLAY_Z)
  })

  test('returns a fresh group per call, so two scenes never share one', () => {
    const first = createCastleBackdrop()
    const second = createCastleBackdrop()

    expect(first).not.toBe(second)
    expect(first.children).toHaveLength(second.children.length)
  })

  test('is its own factory, not an alias of the sky or cave backdrops', () => {
    expect(createCastleBackdrop).not.toBe(createBackdrop)
    expect(createCastleBackdrop).not.toBe(createCaveBackdrop)

    const castle = createCastleBackdrop()
    expect(castle.name).not.toBe(createBackdrop().name)
    expect(castle.name).not.toBe(createCaveBackdrop().name)

    // No hills, no clouds, no rock: those kinds belong to the other two layers.
    for (const foreign of ['hill', 'cloud', 'cave-wall', 'stalactite', 'stalagmite']) {
      expect(childrenOfKind(castle, foreign)).toHaveLength(0)
    }
    for (const mesh of meshesOf(castle)) {
      expect(['wall', 'banner', 'pillar', 'arch']).toContain(mesh.userData['kind'])
    }
  })
})

describe('castle masonry', () => {
  test('is an arcade: pillars carrying arches, enough of each to read as one', () => {
    const castle = createCastleBackdrop()

    expect(childrenOfKind(castle, 'pillar').length).toBeGreaterThanOrEqual(2)
    expect(childrenOfKind(castle, 'arch').length).toBeGreaterThanOrEqual(1)
    expect(childrenOfKind(castle, 'wall').length).toBeGreaterThanOrEqual(1)
  })

  test('stands its pillars on a floor line below the frame, so no cut edge shows', () => {
    for (const pillar of childrenOfKind(createCastleBackdrop(), 'pillar')) {
      expect(bottomOf(pillar)).toBeLessThanOrEqual(-HALF_HEIGHT)
      // Upright: taller than it is wide, or it is a block and not a pillar.
      expect(pillar.scale.y).toBeGreaterThan(pillar.scale.x * 3)
      // Inside the frame, where it can be seen.
      expect(Math.abs(pillar.position.x)).toBeLessThan(HALF_WIDTH)
      expect(topOf(pillar)).toBeGreaterThan(-HALF_HEIGHT)
      expect(topOf(pillar)).toBeLessThan(HALF_HEIGHT)
    }
  })

  test('cuts a void under every arch instead of filling it like a hill dome', () => {
    const arches = childrenOfKind(createCastleBackdrop(), 'arch')

    for (const arch of arches) {
      const params = shapeParams(arch)
      // Cheap. A background silhouette does not need a smooth curve.
      expect(params.curveSegments).toBeLessThanOrEqual(16)

      const radii = archRadii(arch)
      const inner = Math.min(...radii)
      const outer = Math.max(...radii)

      // Nothing reaches the springline centre: that gap is the archway. A filled dome — the
      // hill and cave silhouette — would put vertices at radius 0.
      expect(inner).toBeGreaterThan(0.4)
      // A band, not a hairline: there is real stone between the two arcs.
      expect(outer - inner).toBeGreaterThan(0.15)
      // Unit outer radius, so scale.x is the arch's half-span and scale.y its rise.
      expect(outer).toBeLessThanOrEqual(1.0001)
    }
  })

  test('springs each arch off two pillars of its own row', () => {
    const castle = createCastleBackdrop()
    const pillars = childrenOfKind(castle, 'pillar')

    for (const arch of childrenOfKind(castle, 'arch')) {
      const bay = pillars.filter((pillar) => pillar.position.z === arch.position.z)
      const left = bay.find((pillar) => Math.abs(pillar.position.x - (arch.position.x - arch.scale.x)) < 0.01)
      const right = bay.find((pillar) => Math.abs(pillar.position.x - (arch.position.x + arch.scale.x)) < 0.01)

      expect(left, `no left pillar under the arch at x=${arch.position.x}`).toBeDefined()
      expect(right, `no right pillar under the arch at x=${arch.position.x}`).toBeDefined()
      // The arch springs from the pillar tops, so the bay is one continuous piece of stone.
      expect(topOf(left as THREE.Mesh)).toBeCloseTo(arch.position.y, 5)
      expect(topOf(right as THREE.Mesh)).toBeCloseTo(arch.position.y, 5)
    }
  })

  test('backs the arcade with a wall that overfills the frame', () => {
    const walls = childrenOfKind(createCastleBackdrop(), 'wall')
    const left = Math.min(...walls.map((wall) => wall.position.x - wall.scale.x / 2))
    const right = Math.max(...walls.map((wall) => wall.position.x + wall.scale.x / 2))
    const bottom = Math.min(...walls.map(bottomOf))
    const top = Math.max(...walls.map(topOf))

    // Orthographic: no perspective shrink at BG_Z, so frustum units are world units. A later
    // parallax pass has to be able to slide the layer without exposing an edge.
    expect(left).toBeLessThan(-HALF_WIDTH)
    expect(right).toBeGreaterThan(HALF_WIDTH)
    expect(bottom).toBeLessThan(-HALF_HEIGHT)
    expect(top).toBeGreaterThan(HALF_HEIGHT)
  })
})

describe('castle depth', () => {
  test('sets the arcade in two receding rows, both in front of the wall', () => {
    const castle = createCastleBackdrop()
    const masonry = [...childrenOfKind(castle, 'pillar'), ...childrenOfKind(castle, 'arch')]

    // Two rows, so overlapping opaque silhouettes depth-sort instead of z-fighting.
    const rows = [...new Set(masonry.map((mesh) => mesh.position.z))].sort((a, b) => a - b)
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const [far, near] = rows as [number, number]
    expect(far).toBeLessThan(near)
    // Both rows carry pillars, or the "far row" is a lone arch and not a row.
    for (const row of [far, near]) {
      expect(
        childrenOfKind(castle, 'pillar').filter((pillar) => pillar.position.z === row).length,
      ).toBeGreaterThanOrEqual(2)
    }

    const backmostWallZ = Math.max(...childrenOfKind(castle, 'wall').map((wall) => wall.position.z))
    expect(backmostWallZ).toBeLessThan(far)
  })

  test('offsets the near row from the far one, so neither hides the other', () => {
    const castle = createCastleBackdrop()
    const pillars = childrenOfKind(castle, 'pillar')
    const rows = [...new Set(pillars.map((pillar) => pillar.position.z))].sort((a, b) => a - b)
    const [far, near] = rows as [number, number]

    for (const nearPillar of pillars.filter((pillar) => pillar.position.z === near)) {
      for (const farPillar of pillars.filter((pillar) => pillar.position.z === far)) {
        // A near pillar parked dead in front of a far one would erase it.
        expect(Math.abs(nearPillar.position.x - farPillar.position.x)).toBeGreaterThan(1)
      }
    }
  })

  test('keeps every mesh in the background band, behind gameplay', () => {
    const castle = createCastleBackdrop()
    castle.updateMatrixWorld(true)

    for (const mesh of meshesOf(castle)) {
      const worldZ = worldZOf(mesh)
      expect(worldZ).toBeLessThan(GAMEPLAY_Z)
      expect(worldZ).toBeGreaterThanOrEqual(-40)
      expect(worldZ).toBeLessThanOrEqual(-10)
    }
  })

  test('paints deeper stone darker, so the rows read as distance and not as clutter', () => {
    const meshes = meshesOf(createCastleBackdrop())

    for (const back of meshes) {
      for (const front of meshes) {
        if (back.position.z >= front.position.z) continue
        expect(luma(colorOf(back))).toBeLessThanOrEqual(luma(colorOf(front)))
      }
    }
  })
})

describe('castle palette', () => {
  test('is warm stone: never the hill greens, never the cave indigos', () => {
    const forbidden = [...HILL_HEXES, ...CAVE_HEXES] as readonly number[]
    const brightestCave = Math.max(...CAVE_HEXES.map(luma))

    for (const mesh of meshesOf(createCastleBackdrop())) {
      const hex = colorOf(mesh)
      const { r, g, b } = channels(hex)

      expect(forbidden).not.toContain(hex)
      // Warm: red leads, blue trails. The hills lead with green and the cave leads with blue,
      // so this one ordering keeps the castle clear of both palettes for good.
      expect(r).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(b)
      // Lit stone, not underground rock: paler than anything in the cave.
      expect(luma(hex)).toBeGreaterThan(brightestCave)
    }
  })

  test('is Lambert throughout — this game has no PBR', () => {
    for (const mesh of meshesOf(createCastleBackdrop())) {
      for (const material of materialsOf(mesh)) {
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
        expect(isPbrMaterial(material)).toBe(false)
      }
    }
  })
})

describe('castle backdrop cost', () => {
  test('is a handful of meshes over shared geometries and materials', () => {
    const castle = createCastleBackdrop()
    const meshes = meshesOf(castle)

    // Nothing but meshes hangs off the group: no stray lights, no nested groups.
    expect(meshes).toHaveLength(castle.children.length)
    expect(meshes.length).toBeLessThanOrEqual(20)

    const geometries = new Set(meshes.map((mesh) => mesh.geometry))
    const materials = new Set(meshes.flatMap(materialsOf))

    expect(geometries.size).toBeLessThanOrEqual(4)
    expect(materials.size).toBeLessThanOrEqual(4)
  })

  test('carries no physics: this layer is visual only', () => {
    const castle = createCastleBackdrop()

    expect('update' in castle).toBe(false)
    expect(castle.userData['aabb']).toBeUndefined()

    for (const child of castle.children) {
      expect(child.userData['aabb']).toBeUndefined()
    }
  })
})

describe('the castle backdrop, as src/render publishes it', () => {
  test('is re-exported beside the other two backdrops, and is neither of them', () => {
    expect(typeof createCastleBackdropFromIndex).toBe('function')
    expect(createCastleBackdropFromIndex).toBe(createCastleBackdrop)
    expect(createCastleBackdropFromIndex).not.toBe(createBackdrop)
    expect(createCastleBackdropFromIndex).not.toBe(createCaveBackdrop)
  })

  test('is not hung in the live scene yet — wiring it is a later ticket', () => {
    const scene = createRenderScene()

    expect(scene.getObjectByName('castle-backdrop')).toBeUndefined()
    for (const child of scene.children) {
      expect(child.userData['kind']).not.toBe('arch')
      expect(child.userData['kind']).not.toBe('pillar')
    }
  })
})
