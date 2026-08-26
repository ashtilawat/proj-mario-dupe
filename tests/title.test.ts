import { describe, expect, test, vi } from 'vitest'
import { createHud, createTitle } from '../src/ui/index.ts'
import type { Title } from '../src/ui/index.ts'
import { DEFAULT_HEADING, PROMPT_TEXT } from '../src/ui/title.ts'

describe('createTitle', () => {
  test('builds a DOM overlay, not canvas or scene geometry', () => {
    const title: Title = createTitle()
    expect(title.element.tagName).toBe('DIV')
    expect(title.element.querySelector('canvas')).toBeNull()
    expect(title.element.dataset.titleRoot).toBeDefined()
  })

  test('renders a heading and the exact Press Enter prompt', () => {
    const title = createTitle()
    const heading = title.element.querySelector('[data-title-heading]')
    // A real heading element, not a styled span: this is the page's title.
    expect(heading?.tagName).toBe('H1')
    // Guard the comparison below — it would pass for any DEFAULT_HEADING, including ''.
    expect(DEFAULT_HEADING).not.toBe('')
    expect(heading?.textContent).toBe(DEFAULT_HEADING)
    expect(title.element.querySelector('[data-title-prompt]')?.textContent).toBe('Press Enter')
    expect(PROMPT_TEXT).toBe('Press Enter')
  })

  test('accepts a custom heading', () => {
    const title = createTitle({ heading: 'WORLD 1-1' })
    expect(title.element.querySelector('[data-title-heading]')?.textContent).toBe('WORLD 1-1')
  })
})

describe('title overlay layout', () => {
  test('mounts as an absolute overlay over a canvas sibling', () => {
    const parent = document.createElement('div')
    parent.append(document.createElement('canvas'))
    const title = createTitle()
    title.mount(parent)
    expect(parent.contains(title.element)).toBe(true)
    expect(title.element.style.position).toBe('absolute')
    expect(title.element.style.pointerEvents).toBe('none')
    expect(parent.style.position).toBe('relative')
  })

  test('stacks above the HUD', () => {
    const hud = createHud()
    const title = createTitle()
    // Guard the comparison: Number('') is 0, so without these the assertion below would
    // pass even if neither overlay had a z-index at all.
    expect(hud.element.style.zIndex).not.toBe('')
    expect(title.element.style.zIndex).not.toBe('')
    expect(Number(title.element.style.zIndex)).toBeGreaterThan(Number(hud.element.style.zIndex))
  })
})

describe('title lifecycle', () => {
  test('unmount removes the overlay', () => {
    const parent = document.createElement('div')
    const title = createTitle()
    title.mount(parent)
    title.unmount()
    expect(parent.contains(title.element)).toBe(false)
  })

  test('remounts after unmount', () => {
    const parent = document.createElement('div')
    const title = createTitle()
    title.mount(parent)
    title.unmount()
    title.mount(parent)
    expect(parent.contains(title.element)).toBe(true)
  })
})

describe('title visibility', () => {
  test('starts visible', () => {
    const title = createTitle()
    expect(title.visible).toBe(true)
    expect(title.element.dataset.titleVisible).toBe('true')
    expect(title.element.style.display).toBe('flex')
  })

  test('hide() hides without unmounting', () => {
    const parent = document.createElement('div')
    const title = createTitle()
    title.mount(parent)
    title.hide()
    expect(title.visible).toBe(false)
    expect(title.element.style.display).toBe('none')
    expect(title.element.dataset.titleVisible).toBe('false')
    expect(title.element.getAttribute('aria-hidden')).toBe('true')
    expect(parent.contains(title.element)).toBe(true)
  })

  test('show() restores it', () => {
    const title = createTitle()
    title.hide()
    title.show()
    expect(title.visible).toBe(true)
    expect(title.element.style.display).toBe('flex')
    expect(title.element.getAttribute('aria-hidden')).toBeNull()
  })

  test('show and hide are idempotent', () => {
    const title = createTitle()
    title.hide()
    title.hide()
    expect(title.visible).toBe(false)
    expect(title.element.style.display).toBe('none')
    title.show()
    title.show()
    expect(title.visible).toBe(true)
    expect(title.element.style.display).toBe('flex')
  })

  test('visibility set before mount survives mounting', () => {
    const parent = document.createElement('div')
    const title = createTitle()
    title.hide()
    title.mount(parent)
    expect(title.visible).toBe(false)
    expect(title.element.style.display).toBe('none')
  })
})

describe('title inertness', () => {
  test('registers no listeners and does not start the game', () => {
    // Spied on EventTarget.prototype rather than on window/document, so that binding a
    // handler to the root div or the prompt trips this too. Wiring Enter to an element
    // inside this component is the likeliest way the "inert" contract actually breaks.
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener')
    try {
      const title = createTitle()
      title.mount(document.createElement('div'))
      title.show()
      title.hide()
      expect(addListener).not.toHaveBeenCalled()
    } finally {
      addListener.mockRestore()
    }
  })
})
