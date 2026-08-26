import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import {
  PRD_TUNING_DEFAULTS,
  applyLevelHash,
  createDebugOverlay,
  formatTuningAsSource,
  mountTuningPanel,
  parseLevelHash,
} from '../src/debug'
import type { DebugBody, Tuning } from '../src/debug'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const debugDir = join(root, 'src', 'debug')

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...listFiles(path))
    else out.push(path)
  }
  return out
}

function collect<T extends THREE.Object3D>(
  rootObj: THREE.Object3D,
  predicate: (obj: THREE.Object3D) => obj is T,
): T[] {
  const out: T[] = []
  rootObj.traverse((obj) => {
    if (predicate(obj)) out.push(obj)
  })
  return out
}

function isLine(obj: THREE.Object3D): obj is THREE.Line {
  return obj instanceof THREE.Line
}

function isHitboxLine(obj: THREE.Object3D): obj is THREE.Line {
  return (
    obj instanceof THREE.Line &&
    (obj instanceof THREE.LineLoop ||
      obj instanceof THREE.LineSegments ||
      obj.userData['kind'] === 'hitbox')
  )
}

function isVelocityLine(obj: THREE.Object3D): obj is THREE.Line {
  return (
    obj instanceof THREE.Line &&
    !(obj instanceof THREE.LineLoop) &&
    !(obj instanceof THREE.LineSegments) &&
    (obj.userData['kind'] === 'velocity' || obj.userData['kind'] !== 'hitbox')
  )
}

describe('createDebugOverlay', () => {
  test('does not invent AABBs from scene meshes when bodies are empty', () => {
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1), new THREE.MeshBasicMaterial())
    mesh.position.set(8, 4, 0)
    scene.add(mesh)

    const overlay = createDebugOverlay()
    scene.add(overlay.group)
    overlay.setBodies([])

    const lines = collect(overlay.group, isLine)
    expect(lines).toHaveLength(0)
    expect(collect(overlay.group, isHitboxLine)).toHaveLength(0)

    overlay.dispose()
  })

  test('defaults hitbox and velocity overlays to visible', () => {
    const overlay = createDebugOverlay()
    expect(overlay.hitboxesVisible).toBe(true)
    expect(overlay.velocityVisible).toBe(true)
    overlay.dispose()
  })

  test('injected AABB produces a line overlay that the hitbox toggle hides', () => {
    const overlay = createDebugOverlay()
    const body: DebugBody = { aabb: { x: 1, y: 2, w: 3, h: 4 } }
    overlay.setBodies([body])

    const hitboxes = collect(overlay.group, isHitboxLine)
    expect(hitboxes.length).toBeGreaterThanOrEqual(1)
    expect(hitboxes.every((line) => line.visible)).toBe(true)

    overlay.setHitboxesVisible(false)
    expect(overlay.hitboxesVisible).toBe(false)

    const after = collect(overlay.group, isHitboxLine)
    expect(after.length).toBeGreaterThanOrEqual(1)
    expect(
      after.every((line) => line.visible === false) || overlay.group.children.some((child) => child.visible === false),
    ).toBe(true)

    overlay.setHitboxesVisible(true)
    expect(overlay.hitboxesVisible).toBe(true)
    expect(collect(overlay.group, isHitboxLine).every((line) => line.visible !== false)).toBe(true)

    overlay.dispose()
  })

  test('injected velocity produces a velocity line toggled independently of hitboxes', () => {
    const overlay = createDebugOverlay()
    overlay.setBodies([
      {
        aabb: { x: 0, y: 0, w: 2, h: 2 },
        velocity: { vx: 3, vy: 4 },
      },
    ])

    const velocities = collect(overlay.group, isVelocityLine).filter(
      (line) => line.userData['kind'] === 'velocity' || !(line instanceof THREE.LineLoop),
    )
    expect(velocities.length).toBeGreaterThanOrEqual(1)

    overlay.setHitboxesVisible(false)
    const velocitiesAfterHitboxHide = collect(overlay.group, isVelocityLine).filter(
      (line) => line.userData['kind'] === 'velocity' || !(line instanceof THREE.LineLoop),
    )
    expect(velocitiesAfterHitboxHide.some((line) => line.visible !== false)).toBe(true)

    overlay.setVelocityVisible(false)
    expect(overlay.velocityVisible).toBe(false)
    const hidden = collect(overlay.group, isVelocityLine).filter(
      (line) => line.userData['kind'] === 'velocity' || !(line instanceof THREE.LineLoop),
    )
    expect(
      hidden.every((line) => line.visible === false) || overlay.group.children.some((child) => child.visible === false),
    ).toBe(true)

    overlay.setVelocityVisible(true)
    overlay.setHitboxesVisible(false)
    expect(overlay.velocityVisible).toBe(true)
    expect(overlay.hitboxesVisible).toBe(false)

    overlay.dispose()
  })

  test('setBodies rebuilds overlays from injected data only', () => {
    const overlay = createDebugOverlay()
    overlay.setBodies([{ aabb: { x: 0, y: 0, w: 1, h: 1 } }])
    expect(collect(overlay.group, isHitboxLine).length).toBeGreaterThanOrEqual(1)

    overlay.setBodies([
      { aabb: { x: 2, y: 2, w: 1, h: 1 } },
      { aabb: { x: 5, y: 1, w: 2, h: 2 }, velocity: { vx: 1, vy: 0 } },
    ])
    expect(collect(overlay.group, isHitboxLine).length).toBeGreaterThanOrEqual(2)

    overlay.setBodies([])
    expect(collect(overlay.group, isLine)).toHaveLength(0)

    overlay.dispose()
  })
})

describe('PRD_TUNING_DEFAULTS', () => {
  test('matches PRD 4.2 feel constants', () => {
    expect(PRD_TUNING_DEFAULTS.gravity).toBe(60.0)
    expect(PRD_TUNING_DEFAULTS.jumpVelocity).toBe(23.0)
    expect(PRD_TUNING_DEFAULTS.jumpCutoffFactor).toBe(0.45)
    expect(PRD_TUNING_DEFAULTS.walkMax).toBe(6.0)
    expect(PRD_TUNING_DEFAULTS.dashMax).toBe(9.6)
    expect(PRD_TUNING_DEFAULTS.groundAccel).toBe(30)
    expect(PRD_TUNING_DEFAULTS.groundFriction).toBe(40)
    expect(PRD_TUNING_DEFAULTS.airAccel).toBe(18)
    expect(PRD_TUNING_DEFAULTS.airDrag).toBe(4)
    expect(PRD_TUNING_DEFAULTS.terminalVelocity).toBe(26)
    expect(PRD_TUNING_DEFAULTS.stompBounce).toBe(15)
    expect(PRD_TUNING_DEFAULTS.wallSlideMaxFall).toBe(6)
    expect(PRD_TUNING_DEFAULTS.coyoteTimeMs).toBe(100)
    expect(PRD_TUNING_DEFAULTS.jumpBufferMs).toBe(120)
    expect(PRD_TUNING_DEFAULTS.tileSize).toBe(16)
  })
})

describe('formatTuningAsSource', () => {
  test('emits valid-looking TypeScript with numeric values', () => {
    const source = formatTuningAsSource(PRD_TUNING_DEFAULTS)
    expect(source).toMatch(/export\s+const/)
    expect(source).toMatch(/gravity/i)
    expect(source).toMatch(/60/)
    expect(source).toMatch(/JUMP_VELOCITY|jumpVelocity/)
    expect(source).toMatch(/23/)
    expect(source).toMatch(/0\.45/)
    expect(source).toMatch(/9\.6/)
  })
})

describe('mountTuningPanel', () => {
  test('mounts labeled inputs, live-edits tuning, and copies source to clipboard', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const written: string[] = []
    const clipboard = {
      writeText: async (text: string) => {
        written.push(text)
      },
    }
    const changes: Tuning[] = []

    const panel = mountTuningPanel(container, {
      clipboard,
      onChange: (tuning) => {
        changes.push(tuning)
      },
    })

    const gravity = container.querySelector('input[name="gravity"]')
    const jump = container.querySelector('input[name="jumpVelocity"]')
    expect(gravity).toBeInstanceOf(HTMLInputElement)
    expect(jump).toBeInstanceOf(HTMLInputElement)

    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent ?? '')
    expect(labels.some((text) => /gravity/i.test(text))).toBe(true)
    expect(labels.some((text) => /jump/i.test(text))).toBe(true)

    expect(panel.getTuning().gravity).toBe(60)
    expect(panel.getTuning().jumpVelocity).toBe(23)

    const gravityInput = gravity as HTMLInputElement
    gravityInput.value = '77'
    gravityInput.dispatchEvent(new Event('input', { bubbles: true }))

    expect(panel.getTuning().gravity).toBe(77)
    expect(changes.at(-1)?.gravity).toBe(77)

    const source = await panel.copySource()
    expect(written.length).toBeGreaterThanOrEqual(1)
    const text = written.at(-1) ?? ''
    expect(text).toBe(source)
    expect(text).toMatch(/gravity/i)
    expect(text).toMatch(/77/)
    expect(text).toMatch(/JUMP_VELOCITY|jumpVelocity/)
    expect(text).toMatch(/23/)

    const copyButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      /copy/i.test(btn.textContent ?? ''),
    )
    expect(copyButton).toBeTruthy()
    copyButton?.click()
    await Promise.resolve()
    expect(written.length).toBeGreaterThanOrEqual(2)

    panel.setTuning({ ...panel.getTuning(), walkMax: 12 })
    expect(panel.getTuning().walkMax).toBe(12)

    panel.dispose()
    expect(container.childElementCount).toBe(0)
    container.remove()
  })
})

describe('parseLevelHash', () => {
  test('reads #level= world-stage ids and rejects missing values', () => {
    expect(parseLevelHash('#level=1-1')).toBe('1-1')
    expect(parseLevelHash('#level=2-3')).toBe('2-3')
    expect(parseLevelHash('')).toBeNull()
    expect(parseLevelHash('#foo')).toBeNull()
    expect(parseLevelHash('#')).toBeNull()
    expect(parseLevelHash('#other=1')).toBeNull()
  })
})

describe('applyLevelHash', () => {
  test('calls onWarp with the parsed id and is a no-op stub without a callback', () => {
    const calls: string[] = []
    expect(applyLevelHash('#level=1-1', (id) => calls.push(id))).toBe('1-1')
    expect(calls).toEqual(['1-1'])

    expect(() => applyLevelHash('#level=1-1')).not.toThrow()
    expect(applyLevelHash('#level=1-1')).toBe('1-1')
    expect(applyLevelHash('#foo')).toBeNull()
    expect(applyLevelHash('#foo', (id) => calls.push(id))).toBeNull()
    expect(calls).toEqual(['1-1'])
  })
})

describe('src/debug physics isolation', () => {
  test('does not import rapier, cannon, or ammo', () => {
    const files = listFiles(debugDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/rapier|cannon|ammo/i)
    }
  })
})
