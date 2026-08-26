import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { boot, createCamera, createScene, createWebGLRenderer } from '../src/main'

function stubRenderer() {
  const calls = { render: 0, setSize: [] as Array<[number, number]> }
  const renderer = {
    domElement: document.createElement('canvas'),
    setSize(width: number, height: number) {
      calls.setSize.push([width, height])
    },
    setPixelRatio() {},
    render() {
      calls.render += 1
    },
    dispose() {},
  }
  return { renderer, calls }
}

describe('createCamera', () => {
  test('is an orthographic camera', () => {
    expect(createCamera(16 / 9)).toBeInstanceOf(THREE.OrthographicCamera)
  })

  test('looks down negative Z', () => {
    const camera = createCamera(16 / 9)
    const forward = camera.getWorldDirection(new THREE.Vector3())

    expect(forward.x).toBeCloseTo(0, 5)
    expect(forward.y).toBeCloseTo(0, 5)
    expect(forward.z).toBeCloseTo(-1, 5)
  })

  test('sits on the positive Z axis so the origin is in front of it', () => {
    const camera = createCamera(16 / 9)

    expect(camera.position.x).toBeCloseTo(0, 5)
    expect(camera.position.y).toBeCloseTo(0, 5)
    expect(camera.position.z).toBeGreaterThan(0)
  })

  test('frustum width follows the aspect ratio, height stays fixed', () => {
    const camera = createCamera(2)
    const height = camera.top - camera.bottom
    const width = camera.right - camera.left

    expect(width / height).toBeCloseTo(2, 5)
  })
})

describe('createScene', () => {
  test('is empty — no player, enemies, level geometry, or physics bodies', () => {
    expect(createScene().children).toHaveLength(0)
  })
})

describe('boot', () => {
  test('mounts the renderer canvas into the container', () => {
    const container = document.createElement('div')
    const { renderer } = stubRenderer()

    boot(container, () => renderer as unknown as THREE.WebGLRenderer)

    expect(container.contains(renderer.domElement)).toBe(true)
  })

  test('sizes the renderer to the container', () => {
    const container = document.createElement('div')
    const { renderer, calls } = stubRenderer()

    boot(container, () => renderer as unknown as THREE.WebGLRenderer, { width: 800, height: 400 })

    expect(calls.setSize).toContainEqual([800, 400])
  })

  test('renders the scene with the orthographic camera', () => {
    const container = document.createElement('div')
    const { renderer, calls } = stubRenderer()

    const app = boot(container, () => renderer as unknown as THREE.WebGLRenderer)
    app.render()

    expect(calls.render).toBeGreaterThan(0)
    expect(app.camera).toBeInstanceOf(THREE.OrthographicCamera)
    expect(app.scene.children).toHaveLength(0)
  })

  test('resize updates renderer size and camera frustum', () => {
    const container = document.createElement('div')
    const { renderer, calls } = stubRenderer()

    const app = boot(container, () => renderer as unknown as THREE.WebGLRenderer, {
      width: 800,
      height: 400,
    })
    app.resize(600, 600)

    expect(calls.setSize).toContainEqual([600, 600])
    const aspect = (app.camera.right - app.camera.left) / (app.camera.top - app.camera.bottom)
    expect(aspect).toBeCloseTo(1, 5)
  })
})

describe('createWebGLRenderer', () => {
  // jsdom ships no WebGL implementation. Stubbing getContext to return null keeps the
  // failure quiet while still driving a real THREE.WebGLRenderer construction — the throw
  // comes from three itself, which is the proof this factory uses WebGLRenderer.
  test('constructs a three.js WebGLRenderer against the given canvas', () => {
    const canvas = document.createElement('canvas')
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null

    try {
      expect(() => createWebGLRenderer(canvas)).toThrowError(/WebGL context/i)
    } finally {
      HTMLCanvasElement.prototype.getContext = getContext
    }
  })
})
