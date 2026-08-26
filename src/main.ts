import * as THREE from 'three'

/** Vertical size of the orthographic frustum, in world units. */
export const FRUSTUM_HEIGHT = 10

/** Distance the camera is pulled back along +Z so the origin is in front of it. */
export const CAMERA_DISTANCE = 20

export const BACKGROUND_COLOR = 0x101014

export type RendererFactory = (canvas: HTMLCanvasElement) => THREE.WebGLRenderer

export interface Size {
  width: number
  height: number
}

export interface App {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  renderer: THREE.WebGLRenderer
  resize(width: number, height: number): void
  render(): void
  dispose(): void
}

/**
 * Orthographic camera parked on +Z, looking down -Z at the origin.
 * The frustum height is fixed; width follows the viewport aspect ratio.
 */
export function createCamera(aspect: number): THREE.OrthographicCamera {
  const halfHeight = FRUSTUM_HEIGHT / 2
  const halfWidth = halfHeight * aspect
  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.1,
    1000,
  )
  camera.position.set(0, 0, CAMERA_DISTANCE)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  return camera
}

/** An empty scene. M0 renders nothing but the clear color. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)
  return scene
}

export const createWebGLRenderer: RendererFactory = (canvas) =>
  new THREE.WebGLRenderer({ canvas, antialias: true })

export function boot(
  container: HTMLElement,
  createRenderer: RendererFactory = createWebGLRenderer,
  size: Size = { width: window.innerWidth, height: window.innerHeight },
): App {
  const renderer = createRenderer(document.createElement('canvas'))
  const scene = createScene()
  const camera = createCamera(size.width / size.height)

  container.appendChild(renderer.domElement)

  const app: App = {
    scene,
    camera,
    renderer,
    resize(width, height) {
      const halfHeight = FRUSTUM_HEIGHT / 2
      const halfWidth = halfHeight * (width / height)
      camera.left = -halfWidth
      camera.right = halfWidth
      camera.top = halfHeight
      camera.bottom = -halfHeight
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    },
    render() {
      renderer.render(scene, camera)
    },
    dispose() {
      renderer.dispose()
      renderer.domElement.remove()
    },
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  app.resize(size.width, size.height)

  return app
}

/** Browser entry point. Boots the renderer and starts the render loop. */
function main(): void {
  const container = document.getElementById('app')
  if (!container) throw new Error('#app container not found')

  const app = boot(container)
  window.addEventListener('resize', () => app.resize(window.innerWidth, window.innerHeight))

  const loop = (): void => {
    app.render()
    window.requestAnimationFrame(loop)
  }
  window.requestAnimationFrame(loop)
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  main()
}
