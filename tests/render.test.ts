import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  BG_Z,
  CAMERA_DISTANCE,
  FG_Z,
  FRUSTUM_HEIGHT,
  GAMEPLAY_Z,
  createCamera,
  createLights,
  createPlayerCapsule,
  createRenderScene,
  createRenderer,
  createTileLayer,
  getDrawCallCount,
} from '../src/render'

function isInstancedMesh(object: THREE.Object3D): object is THREE.InstancedMesh {
  return object instanceof THREE.InstancedMesh
}

function isPlainMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh)
}

function materialsOf(object: THREE.Mesh): THREE.Material[] {
  return Array.isArray(object.material) ? object.material : [object.material]
}

function isPbrMaterial(material: THREE.Material): boolean {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  )
}

describe('constants', () => {
  test('match the M0 camera and layer layout', () => {
    expect(FRUSTUM_HEIGHT).toBe(10)
    expect(CAMERA_DISTANCE).toBe(20)
    expect(GAMEPLAY_Z).toBe(0)
    expect(BG_Z).toBe(-20)
    expect(BG_Z).toBeGreaterThanOrEqual(-40)
    expect(BG_Z).toBeLessThanOrEqual(-10)
    expect(FG_Z).toBe(10)
  })
})

describe('createCamera', () => {
  test('is an OrthographicCamera on +Z looking down -Z', () => {
    const camera = createCamera(16 / 9)

    expect(camera).toBeInstanceOf(THREE.OrthographicCamera)

    const forward = camera.getWorldDirection(new THREE.Vector3())
    expect(forward.x).toBeCloseTo(0, 5)
    expect(forward.y).toBeCloseTo(0, 5)
    expect(forward.z).toBeCloseTo(-1, 5)

    expect(camera.position.z).toBeGreaterThan(0)
  })

  test('frustum width follows aspect; height stays fixed', () => {
    const wide = createCamera(2)
    const square = createCamera(1)

    const wideHeight = wide.top - wide.bottom
    const wideWidth = wide.right - wide.left
    const squareHeight = square.top - square.bottom

    expect(wideWidth / wideHeight).toBeCloseTo(2, 5)
    expect(wideHeight).toBeCloseTo(squareHeight, 5)
    expect(wideHeight).toBeCloseTo(FRUSTUM_HEIGHT, 5)
  })
})

describe('createTileLayer', () => {
  test('returns an InstancedMesh of quads with instance matrices and layer z', () => {
    const layer = createTileLayer({ count: 4, z: GAMEPLAY_Z, color: 0x4488ff })

    expect(layer).toBeInstanceOf(THREE.InstancedMesh)
    expect(layer).not.toBeInstanceOf(THREE.CapsuleGeometry)
    expect(layer.count).toBe(4)
    expect(layer.position.z).toBe(GAMEPLAY_Z)
    expect(layer.geometry).toBeInstanceOf(THREE.PlaneGeometry)

    const matrix = new THREE.Matrix4()
    layer.getMatrixAt(0, matrix)
    expect(matrix.elements[0]).not.toBe(0)

    for (const material of materialsOf(layer)) {
      expect(isPbrMaterial(material)).toBe(false)
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
    }
  })
})

describe('createPlayerCapsule', () => {
  test('is a Mesh with CapsuleGeometry near the origin', () => {
    const player = createPlayerCapsule()

    expect(player).toBeInstanceOf(THREE.Mesh)
    expect(player.geometry).toBeInstanceOf(THREE.CapsuleGeometry)
    expect(player.geometry.type).toBe('CapsuleGeometry')
    expect(player.position.x).toBeCloseTo(0, 1)
    expect(player.position.z).toBeCloseTo(0, 1)

    for (const material of materialsOf(player)) {
      expect(isPbrMaterial(material)).toBe(false)
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
    }
  })
})

describe('createLights', () => {
  test('returns a directional and hemisphere light', () => {
    const lights = createLights()

    expect(lights.directional).toBeInstanceOf(THREE.DirectionalLight)
    expect(lights.hemisphere).toBeInstanceOf(THREE.HemisphereLight)
  })
})

describe('createRenderScene', () => {
  test('has three instanced tile layers, one capsule mesh, and both lights', () => {
    const scene = createRenderScene()

    expect(scene).toBeInstanceOf(THREE.Scene)

    const instanced = scene.children.filter(isInstancedMesh)
    const meshes = scene.children.filter(isPlainMesh)
    const directional = scene.children.filter((child) => child instanceof THREE.DirectionalLight)
    const hemisphere = scene.children.filter((child) => child instanceof THREE.HemisphereLight)

    expect(instanced).toHaveLength(3)

    const zs = instanced.map((mesh) => mesh.position.z).sort((a, b) => a - b)
    const bgZ = zs[0]
    const gameplayZ = zs[1]
    const fgZ = zs[2]

    expect(bgZ).toBeDefined()
    expect(gameplayZ).toBeDefined()
    expect(fgZ).toBeDefined()
    expect(bgZ).toBeGreaterThanOrEqual(-40)
    expect(bgZ).toBeLessThanOrEqual(-10)
    expect(bgZ).toBe(BG_Z)
    expect(gameplayZ).toBe(GAMEPLAY_Z)
    expect(gameplayZ).toBe(0)
    expect(fgZ).toBe(FG_Z)
    expect(fgZ).toBe(10)

    expect(meshes).toHaveLength(1)
    const player = meshes[0]
    if (!player) {
      throw new Error('expected a player capsule Mesh')
    }
    expect(player.geometry).toBeInstanceOf(THREE.CapsuleGeometry)
    expect(player.geometry.type).toBe('CapsuleGeometry')

    expect(directional).toHaveLength(1)
    expect(hemisphere).toHaveLength(1)

    const tileMeshes = scene.children.filter(
      (child) => isPlainMesh(child) && !(child.geometry instanceof THREE.CapsuleGeometry),
    )
    expect(tileMeshes).toHaveLength(0)

    for (const object of [...instanced, ...meshes]) {
      for (const material of materialsOf(object)) {
        expect(isPbrMaterial(material)).toBe(false)
        expect(material).not.toBeInstanceOf(THREE.MeshStandardMaterial)
        expect(material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial)
      }
    }
  })
})

describe('getDrawCallCount', () => {
  test('reads renderer.info.render.calls', () => {
    expect(getDrawCallCount({ info: { render: { calls: 7 } } })).toBe(7)
  })
})

describe('createRenderer', () => {
  // jsdom ships no WebGL implementation. Stubbing getContext to return null keeps the
  // failure quiet while still driving a real THREE.WebGLRenderer construction — the throw
  // comes from three itself, which is the proof this factory uses WebGLRenderer.
  test('constructs a three.js WebGLRenderer against the given canvas', () => {
    const canvas = document.createElement('canvas')
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null

    try {
      expect(() => createRenderer(canvas)).toThrowError(/WebGL context/i)
    } finally {
      HTMLCanvasElement.prototype.getContext = getContext
    }
  })
})
