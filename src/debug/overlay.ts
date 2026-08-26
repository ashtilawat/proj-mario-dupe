import * as THREE from 'three'
import type { DebugBody } from './types.ts'

const HITBOX_COLOR = 0x22ee88
const VELOCITY_COLOR = 0xff55aa
const OVERLAY_Z = 0.25

export type DebugOverlay = {
  readonly group: THREE.Group
  setBodies(bodies: DebugBody[]): void
  setHitboxesVisible(visible: boolean): void
  setVelocityVisible(visible: boolean): void
  readonly hitboxesVisible: boolean
  readonly velocityVisible: boolean
  dispose(): void
}

function clearLineGroup(group: THREE.Group): void {
  const children = [...group.children]
  for (const child of children) {
    group.remove(child)
    if (child instanceof THREE.Line) {
      child.geometry.dispose()
    }
  }
}

function applyVisible(group: THREE.Group, visible: boolean): void {
  group.visible = visible
  for (const child of group.children) {
    child.visible = visible
  }
}

/**
 * Line overlays for injected 2D AABBs / velocities. Never inspects a scene
 * graph — hitboxes come only from setBodies().
 */
export function createDebugOverlay(): DebugOverlay {
  const group = new THREE.Group()
  group.name = 'debug-overlay'

  const hitboxGroup = new THREE.Group()
  hitboxGroup.name = 'debug-hitboxes'
  const velocityGroup = new THREE.Group()
  velocityGroup.name = 'debug-velocities'
  group.add(hitboxGroup, velocityGroup)

  const hitboxMaterial = new THREE.LineBasicMaterial({ color: HITBOX_COLOR })
  const velocityMaterial = new THREE.LineBasicMaterial({ color: VELOCITY_COLOR })

  let hitboxesVisible = true
  let velocityVisible = true
  hitboxGroup.visible = true
  velocityGroup.visible = true

  function setBodies(bodies: DebugBody[]): void {
    clearLineGroup(hitboxGroup)
    clearLineGroup(velocityGroup)

    for (const body of bodies) {
      const { x, y, w, h } = body.aabb
      const corners = [
        new THREE.Vector3(x, y, OVERLAY_Z),
        new THREE.Vector3(x + w, y, OVERLAY_Z),
        new THREE.Vector3(x + w, y + h, OVERLAY_Z),
        new THREE.Vector3(x, y + h, OVERLAY_Z),
      ]
      const hitboxGeom = new THREE.BufferGeometry().setFromPoints(corners)
      const hitbox = new THREE.LineLoop(hitboxGeom, hitboxMaterial)
      hitbox.userData['kind'] = 'hitbox'
      hitbox.visible = hitboxesVisible
      hitboxGroup.add(hitbox)

      if (body.velocity) {
        const cx = x + w / 2
        const cy = y + h / 2
        const { vx, vy } = body.velocity
        const velGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cx, cy, OVERLAY_Z),
          new THREE.Vector3(cx + vx, cy + vy, OVERLAY_Z),
        ])
        const vel = new THREE.Line(velGeom, velocityMaterial)
        vel.userData['kind'] = 'velocity'
        vel.visible = velocityVisible
        velocityGroup.add(vel)
      }
    }

    applyVisible(hitboxGroup, hitboxesVisible)
    applyVisible(velocityGroup, velocityVisible)
  }

  function setHitboxesVisible(visible: boolean): void {
    hitboxesVisible = visible
    applyVisible(hitboxGroup, visible)
  }

  function setVelocityVisible(visible: boolean): void {
    velocityVisible = visible
    applyVisible(velocityGroup, visible)
  }

  function dispose(): void {
    clearLineGroup(hitboxGroup)
    clearLineGroup(velocityGroup)
    hitboxMaterial.dispose()
    velocityMaterial.dispose()
    group.remove(hitboxGroup)
    group.remove(velocityGroup)
    group.removeFromParent()
  }

  return {
    group,
    setBodies,
    setHitboxesVisible,
    setVelocityVisible,
    get hitboxesVisible() {
      return hitboxesVisible
    },
    get velocityVisible() {
      return velocityVisible
    },
    dispose,
  }
}
