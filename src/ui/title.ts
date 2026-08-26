// The card's default second line. `main.ts` builds the live title with a heading only, so
// the tagline has to come from here or it would never reach the screen.
import { tagline as storyTagline } from '../story/index.ts'

export interface Title {
  readonly element: HTMLElement
  readonly visible: boolean
  mount(parent: HTMLElement): void
  unmount(): void
  show(): void
  hide(): void
}

export interface TitleOptions {
  heading?: string
  tagline?: string
}

export const DEFAULT_HEADING = 'UNTITLED 2.5D PLATFORMER'
export const PROMPT_TEXT = 'Press Enter'

// Shared by applyOverlayStyle() and render() so the shown display value cannot drift.
const VISIBLE_DISPLAY = 'flex'

function applyOverlayStyle(el: HTMLElement): void {
  el.style.position = 'absolute'
  el.style.inset = '0'
  // Above the HUD's z-index of 10 — the title curtain covers the whole frame.
  el.style.zIndex = '20'
  // Provisional, and only right while the card is inert: it is a full-frame curtain, so
  // once something here is clickable this should become 'auto' so it stops passing clicks
  // through to the canvas. The test asserting 'none' is describing today, not a contract.
  el.style.pointerEvents = 'none'
  el.style.display = VISIBLE_DISPLAY
  el.style.flexDirection = 'column'
  el.style.justifyContent = 'center'
  el.style.alignItems = 'center'
  el.style.gap = '24px'
  el.style.boxSizing = 'border-box'
  el.style.background = 'rgba(16, 16, 20, 0.72)'
  el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  el.style.color = '#fff'
  el.style.textShadow = '0 1px 0 #000'
}

/**
 * The title card is deliberately inert: it renders copy and nothing else. It
 * binds no listeners and knows nothing about Enter or the game loop, so the
 * caller owns when it is shown and hidden.
 */
export function createTitle(options: TitleOptions = {}): Title {
  const root = document.createElement('div')
  root.dataset.titleRoot = ''
  applyOverlayStyle(root)

  const heading = document.createElement('h1')
  heading.dataset.titleHeading = ''
  heading.textContent = options.heading ?? DEFAULT_HEADING
  // UA margins on h1/p fight the flex gap, so zero them explicitly.
  heading.style.margin = '0'
  heading.style.fontSize = '32px'
  heading.style.fontWeight = '700'
  heading.style.letterSpacing = '0.12em'

  const tagline = document.createElement('p')
  tagline.dataset.titleTagline = ''
  tagline.textContent = options.tagline ?? storyTagline
  tagline.style.margin = '0'
  tagline.style.fontSize = '16px'
  tagline.style.fontWeight = '500'
  tagline.style.letterSpacing = '0.04em'
  tagline.style.opacity = '0.9'

  const prompt = document.createElement('p')
  prompt.dataset.titlePrompt = ''
  prompt.textContent = PROMPT_TEXT
  prompt.style.margin = '0'
  prompt.style.fontSize = '14px'
  prompt.style.fontWeight = '600'
  prompt.style.letterSpacing = '0.08em'
  prompt.style.opacity = '0.85'

  root.append(heading, tagline, prompt)

  // A fresh title starts visible; the DOM is built once and only toggled after.
  let visible = true

  function render(): void {
    // Not element.hidden: the inline `display: flex` outranks the UA
    // `[hidden] { display: none }` rule, so the card would stay on screen.
    root.style.display = visible ? VISIBLE_DISPLAY : 'none'
    root.dataset.titleVisible = String(visible)
    if (visible) root.removeAttribute('aria-hidden')
    else root.setAttribute('aria-hidden', 'true')
  }
  render()

  return {
    element: root,
    // Getter, not a snapshot, so it tracks the closure flag.
    get visible() {
      return visible
    },
    mount(parent: HTMLElement) {
      // Same positioning guard as Hud.mount; sharing it would mean editing
      // hud.ts, which is out of scope for this ticket.
      const pos = getComputedStyle(parent).position
      if (pos === 'static' || pos === '') parent.style.position = 'relative'
      parent.appendChild(root)
    },
    unmount() {
      root.remove()
    },
    show() {
      visible = true
      render()
    },
    hide() {
      visible = false
      render()
    },
  }
}
