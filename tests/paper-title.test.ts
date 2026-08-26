/**
 * T-056 — the title stops being a dark debug curtain.
 *
 * The card is cream paper cut from the same stock as the HUD (T-053): PAPER #f4ead2,
 * PAPER_EDGE #e0d0a8, INK #3a2a18. `title.ts` duplicates those hexes rather than
 * importing them from hud.ts, so these tests assert the look, not the constant.
 */
import { describe, expect, test } from 'vitest'
import { tagline as storyTagline } from '../src/story/index.ts'
import { createHud, createTitle } from '../src/ui/index.ts'
import { DEFAULT_HEADING, PROMPT_TEXT } from '../src/ui/title.ts'

/** The dark curtain this ticket removes. Named so a regression reads as itself. */
const OLD_CURTAIN = 'rgba(16, 16, 20, 0.72)'

function rgba(color: string): [number, number, number, number] {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color)
  if (!m) throw new Error(`not an rgb color: ${JSON.stringify(color)}`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
}

function isCream(color: string): boolean {
  const [r, g, b] = rgba(color)
  return r > 220 && r < 255 && r > g && g > b && r - b > 15
}

function card(title: { element: HTMLElement }): HTMLElement {
  const el = title.element.querySelector<HTMLElement>('[data-title-paper]')
  if (!el) throw new Error('no [data-title-paper] card in the title')
  return el
}

function line(title: { element: HTMLElement }, hook: string): HTMLElement {
  const el = title.element.querySelector<HTMLElement>(`[data-title-${hook}]`)
  if (!el) throw new Error(`no [data-title-${hook}] in the title`)
  return el
}

describe('paper title card', () => {
  test('the heading, tagline and prompt all sit on one cream card', () => {
    const title = createTitle()
    const paper = card(title)
    for (const hook of ['heading', 'tagline', 'prompt']) {
      expect(paper.contains(line(title, hook)), `${hook} is off the card`).toBe(true)
    }
    expect(paper.style.backgroundColor).not.toBe('')
    expect(paper.style.backgroundColor).not.toBe('transparent')
    expect(paper.style.backgroundColor).not.toBe(OLD_CURTAIN)
    expect(isCream(paper.style.backgroundColor)).toBe(true)
  })

  test('the card has a soft paper edge: darker cream border, radius, drop shadow', () => {
    const paper = card(createTitle())
    expect(paper.style.borderStyle).toBe('solid')
    expect(paper.style.borderWidth).toBe('1px')
    expect(isCream(paper.style.borderColor)).toBe(true)
    const [br] = rgba(paper.style.borderColor)
    const [cr] = rgba(paper.style.backgroundColor)
    expect(br).toBeLessThan(cr)
    expect(paper.style.borderRadius).not.toBe('')
    expect(paper.style.boxShadow).not.toBe('')
    expect(paper.style.boxShadow).not.toBe('none')
  })

  test('every line reads as ink on paper, not white on void', () => {
    const title = createTitle()
    for (const hook of ['heading', 'tagline', 'prompt']) {
      const el = line(title, hook)
      expect(el.style.color, `${hook} has no colour of its own`).not.toBe('')
      expect(el.style.color).not.toBe('#fff')
      expect(el.style.color).not.toBe('rgb(255, 255, 255)')
      const [r, g, b] = rgba(el.style.color)
      expect(r + g + b, `${hook} is too light to be ink`).toBeLessThan(300)
      expect(el.style.textShadow === '' || el.style.textShadow === 'none').toBe(true)
    }
  })

  test('the overlay root is no longer the dark curtain', () => {
    const root = createTitle().element
    expect(root.style.background).not.toBe(OLD_CURTAIN)
    expect(root.style.backgroundColor).not.toBe(OLD_CURTAIN)
    // Whatever wash is left has to stay light enough to read the frame through.
    const wash = root.style.backgroundColor
    if (wash !== '' && wash !== 'transparent') expect(rgba(wash)[3]).toBeLessThan(0.4)
  })
})

describe('the paper title still says what it said', () => {
  test('keeps the heading, tagline and prompt on their own element types', () => {
    const title = createTitle()
    expect(line(title, 'heading').tagName).toBe('H1')
    expect(line(title, 'tagline').tagName).toBe('P')
    expect(line(title, 'prompt').tagName).toBe('P')
    expect(line(title, 'heading').textContent).toBe(DEFAULT_HEADING)
    expect(line(title, 'tagline').textContent).toBe(storyTagline)
    expect(line(title, 'prompt').textContent).toBe(PROMPT_TEXT)
  })

  test('custom heading and tagline still reach the card', () => {
    const title = createTitle({ heading: 'WORLD 1-1', tagline: 'A tiny light.' })
    expect(line(title, 'heading').textContent).toBe('WORLD 1-1')
    expect(line(title, 'tagline').textContent).toBe('A tiny light.')
    expect(card(title).contains(line(title, 'tagline'))).toBe(true)
  })
})

describe('the paper card keeps the overlay contract main.ts relies on', () => {
  test('the root is still a click-through absolute overlay above the HUD', () => {
    const title = createTitle()
    expect(title.element.style.position).toBe('absolute')
    expect(title.element.style.pointerEvents).toBe('none')
    expect(Number(title.element.style.zIndex)).toBeGreaterThan(
      Number(createHud().element.style.zIndex),
    )
    expect(card(title).parentElement).toBe(title.element)
  })

  test('hide and show still toggle the whole overlay, card and all', () => {
    const parent = document.createElement('div')
    const title = createTitle()
    title.mount(parent)
    expect(title.visible).toBe(true)
    expect(title.element.style.display).toBe('flex')

    title.hide()
    expect(title.visible).toBe(false)
    expect(title.element.style.display).toBe('none')
    expect(parent.contains(card(title))).toBe(true)

    title.show()
    expect(title.visible).toBe(true)
    expect(title.element.style.display).toBe('flex')
  })
})
