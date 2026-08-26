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
