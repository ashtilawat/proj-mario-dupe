import { describe, expect, test } from 'vitest'
import { createHud } from '../src/ui/index.ts'

describe('createHud', () => {
  test('builds a DOM overlay, not canvas or scene geometry', () => {
    const hud = createHud()
    expect(hud.element.tagName).toBe('DIV')
    expect(hud.element.querySelector('canvas')).toBeNull()
    expect(hud.element.dataset.hudRoot).toBeDefined()
  })
  test('defaults to 0 coins, 3 lives, small', () => {
    const hud = createHud()
    expect(hud.getState()).toEqual({ coins: 0, lives: 3, power: 'small' })
    expect(hud.element.dataset.coins).toBe('0')
    expect(hud.element.dataset.lives).toBe('3')
    expect(hud.element.dataset.power).toBe('small')
    expect(hud.element.textContent).toMatch(/SMALL/)
  })
})

describe('HUD overlay layout', () => {
  test('mounts above a canvas sibling as absolute HTML', () => {
    const parent = document.createElement('div')
    const canvas = document.createElement('canvas')
    parent.append(canvas)
    const hud = createHud()
    hud.mount(parent)
    expect(parent.contains(hud.element)).toBe(true)
    expect(hud.element.style.position).toBe('absolute')
    expect(hud.element.style.zIndex).toBe('10')
    expect(hud.element.style.pointerEvents).toBe('none')
    expect(parent.style.position).toBe('relative')
    expect(canvas.nextSibling === hud.element || parent.contains(canvas)).toBe(true)
  })
  test('unmount removes the overlay', () => {
    const parent = document.createElement('div')
    const hud = createHud()
    hud.mount(parent)
    hud.unmount()
    expect(parent.contains(hud.element)).toBe(false)
  })
})

describe('HUD API', () => {
  test('setCoins, setLives, and setPower update state and DOM', () => {
    const hud = createHud()
    hud.setCoins(12)
    hud.setLives(2)
    hud.setPower('big')
    expect(hud.getState()).toEqual({ coins: 12, lives: 2, power: 'big' })
    expect(hud.element.dataset.coins).toBe('12')
    expect(hud.element.dataset.lives).toBe('2')
    expect(hud.element.dataset.power).toBe('big')
    expect(hud.element.querySelector('[data-hud-value="coins"]')?.textContent).toBe('x 12')
    expect(hud.element.querySelector('[data-hud-value="lives"]')?.textContent).toBe('x 2')
    expect(hud.element.querySelector('[data-hud-value="power"]')?.textContent).toBe('BIG')
  })
  test('createHud accepts initial state', () => {
    const hud = createHud({ coins: 5, lives: 1, power: 'big' })
    expect(hud.getState()).toEqual({ coins: 5, lives: 1, power: 'big' })
  })
})
