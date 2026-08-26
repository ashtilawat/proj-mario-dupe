import { describe, expect, test } from 'vitest'
import { createHud } from '../src/ui/index.ts'

function rgb(color: string): [number, number, number] {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!m) throw new Error(`not an rgb color: ${JSON.stringify(color)}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isCream(color: string): boolean {
  const [r, g, b] = rgb(color)
  return r > 220 && r < 255 && r > g && g > b && r - b > 15
}

function card(hud: { element: HTMLElement }): HTMLElement {
  const el = hud.element.querySelector<HTMLElement>('[data-hud-paper]')
  if (!el) throw new Error('no [data-hud-paper] card in the HUD')
  return el
}

describe('paper HUD card', () => {
  test('coins and lives sit on a cream paper card', () => {
    const hud = createHud()
    const paper = card(hud)
    expect(paper.contains(hud.element.querySelector('[data-hud-value="coins"]'))).toBe(true)
    expect(paper.contains(hud.element.querySelector('[data-hud-value="lives"]'))).toBe(true)
    expect(paper.style.backgroundColor).not.toBe('')
    expect(paper.style.backgroundColor).not.toBe('transparent')
    expect(isCream(paper.style.backgroundColor)).toBe(true)
  })

  test('the card has a soft paper edge: darker cream border, radius, drop shadow', () => {
    const paper = card(createHud())
    expect(paper.style.borderStyle).toBe('solid')
    expect(paper.style.borderWidth).toBe('1px')
    expect(isCream(paper.style.borderColor)).toBe(true)
    const [br] = rgb(paper.style.borderColor)
    const [cr] = rgb(paper.style.backgroundColor)
    expect(br).toBeLessThan(cr)
    expect(paper.style.borderRadius).not.toBe('')
    expect(paper.style.boxShadow).not.toBe('')
    expect(paper.style.boxShadow).not.toBe('none')
  })

  test('coins and lives read as ink on paper, not white on void', () => {
    const hud = createHud()
    for (const attr of ['coins', 'lives']) {
      const item = hud.element.querySelector<HTMLElement>(`[data-hud-item="${attr}"]`)
      expect(item, `missing ${attr} item`).not.toBeNull()
      expect(item!.style.color).not.toBe('')
      expect(item!.style.color).not.toBe('#fff')
      expect(item!.style.color).not.toBe('rgb(255, 255, 255)')
      const [r, g, b] = rgb(item!.style.color)
      expect(r + g + b).toBeLessThan(300)
      expect(item!.style.textShadow === '' || item!.style.textShadow === 'none').toBe(true)
    }
  })

  test('the STATE item stays white on the transparent overlay', () => {
    const hud = createHud()
    const power = hud.element.querySelector<HTMLElement>('[data-hud-item="power"]')
    expect(power).not.toBeNull()
    expect(card(hud).contains(power)).toBe(false)
    expect(power!.style.color === '' || power!.style.color === 'rgb(255, 255, 255)').toBe(true)
    expect(hud.element.querySelector('[data-hud-value="power"]')?.textContent).toBe('SMALL')
  })

  test('the paper card does not swallow clicks or leave the overlay', () => {
    const hud = createHud()
    expect(hud.element.style.pointerEvents).toBe('none')
    expect(hud.element.style.zIndex).toBe('10')
    expect(hud.element.style.position).toBe('absolute')
    expect(card(hud).parentElement).toBe(hud.element)
  })

  test('the card keeps rendering live values', () => {
    const hud = createHud()
    hud.setCoins(12)
    hud.setLives(2)
    expect(hud.element.querySelector('[data-hud-value="coins"]')?.textContent).toBe('x 12')
    expect(hud.element.querySelector('[data-hud-value="lives"]')?.textContent).toBe('x 2')
    expect(hud.element.dataset.coins).toBe('12')
  })
})
