/**
 * T-052 — the flag toast. Taking a flag no longer swaps the level out from under the
 * player on the touch frame: the level's story line goes up for a beat, the run freezes
 * behind it exactly the way it freezes behind the title and the end cards, and only when
 * the beat is over does the existing `advance` run.
 *
 * The copy itself belongs to `src/story` and is asserted through `flagLines` rather than
 * as literals, so a wording change stays a one-file change over there.
 *
 * `loadLevel` is mocked with a pass-through to the real data purely to add `x-1`: a level
 * World 1 has no line for, which is the "no copy, no toast" path.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT } from '../src/engine/index.ts'
import { START_LIVES, WIN_TEXT, startGame, type Game } from '../src/main'
import { elapseFlagToast } from './helpers/flag-toast.ts'
import { flagLines } from '../src/story/index.ts'
import type { Level } from '../src/levels/index.ts'

const { UNSUNG } = vi.hoisted(() => ({
  // 8x6, five empty rows over a solid floor, with a flag at the far end. Its id is one no
  // line was ever written for.
  UNSUNG: {
    id: 'x-1',
    size: [8, 6],
    tiles: '40:0,8:1',
    spawn: [1, 1],
    checkpoint: [5, 1],
    entities: [{ type: 'flag', at: [7, 1] }],
    regions: [],
    theme: 'grass',
  },
}))

vi.mock('../src/levels/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/levels/index.ts')>()
  return {
    ...actual,
    loadLevel: (id: string): Level => {
      if (id === 'x-1') return UNSUNG as unknown as Level
      return actual.loadLevel(id)
    },
  }
})

import { loadLevel } from '../src/levels/index.ts'

/** jsdom ships no WebGL; every test drives the real wiring through this stub. */
function stubRenderer() {
  return {
    domElement: document.createElement('canvas'),
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  }
}

let started: Game | null = null

/** Boots a run and drops the title card, the way a player starts one. */
function start(hash = '') {
  window.location.hash = hash
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(
    container,
    () => stubRenderer() as unknown as THREE.WebGLRenderer,
    { width: 800, height: 400 },
  )
  pressEnter(container)
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
  // The hash is global to the jsdom window; a leftover one would boot the next file's run
  // into the wrong level.
  window.location.hash = ''
})

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

function pressSpace(container: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  })
  container.dispatchEvent(event)
  return event
}

function toast(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-flag-toast]')
  if (!element) throw new Error('no flag toast in the container')
  return element
}

function toastText(container: HTMLElement): string {
  return container.querySelector<HTMLElement>('[data-flag-toast-text]')?.textContent ?? ''
}

function toastIsUp(container: HTMLElement): boolean {
  return toast(container).style.display !== 'none'
}

function endCard(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-game-overlay]')
  if (!element) throw new Error('no end-card overlay in the container')
  return element
}

/** Walks the player onto the given level's flag and runs the step that takes it. */
function takeFlag(game: Game, id: string): void {
  const flag = loadLevel(id).entities.find((entity) => entity.type === 'flag')
  if (!flag) throw new Error('no flag in level ' + id)
  game.player.body.aabb.x = flag.at[0]
  game.player.body.aabb.y = flag.at[1]
  game.loop.tick(FIXED_DT)
}

describe('the toast overlay', () => {
  test('is mounted but hidden while the level is being played', () => {
    const { container } = start()

    expect(toast(container).style.display).toBe('none')
    expect(toastText(container)).toBe('')
  })

  test('sits above the HUD, which owns z-index 10', () => {
    const { container } = start()

    const hud = container.querySelector<HTMLElement>('[data-hud-root]')
    expect(Number(toast(container).style.zIndex)).toBeGreaterThan(Number(hud!.style.zIndex))
  })

  test('is taken out of the container again on dispose', () => {
    const { container, game } = start()
    started = null

    game.dispose()

    expect(container.querySelector('[data-flag-toast]')).toBeNull()
  })
})

describe('taking the 1-1 flag', () => {
  test('shows that level line instead of advancing on the touch frame', () => {
    const { container, game } = start()

    takeFlag(game, '1-1')

    expect(toastIsUp(container)).toBe(true)
    expect(toastText(container)).toBe(flagLines['1-1'])
    expect(game.grid.width).toBe(loadLevel('1-1').size[0])
  })

  test('advances to 1-2 once the beat is over', () => {
    const { container, game } = start()
    takeFlag(game, '1-1')

    elapseFlagToast(game, container)

    expect(game.grid.width).toBe(loadLevel('1-2').size[0])
    expect(game.grid.width).not.toBe(loadLevel('1-1').size[0])
    expect(game.player.body.aabb.x).toBeCloseTo(loadLevel('1-2').spawn[0]!, 5)
  })

  test('takes the toast down before the next level is up', () => {
    const { container, game } = start()
    takeFlag(game, '1-1')

    elapseFlagToast(game, container)

    expect(toastIsUp(container)).toBe(false)
    expect(toastText(container)).toBe('')
  })

  test('freezes the run behind the line — no walkers, no pit, no second flag', () => {
    const { container, game } = start()
    takeFlag(game, '1-1')
    // After the take, not before it: the frame the flag is touched on is an ordinary live
    // step — the freeze starts on the one after it, which is what this pins.
    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x

    // A live simulation would carry all three of these into the next step.
    game.player.body.velocity.x = 6
    game.player.body.aabb.y = -10
    game.player.body.velocity.y = -12
    for (let i = 0; i < 10; i++) game.loop.tick(FIXED_DT)

    expect(walker.aabb.x).toBeCloseTo(walkerX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(-10, 5)
    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(game.grid.width).toBe(loadLevel('1-1').size[0])
    expect(toastIsUp(container)).toBe(true)
  })

  test('is not an end card: Enter neither restarts the run nor dismisses the line', () => {
    const { container, game } = start()
    takeFlag(game, '1-1')

    pressEnter(container)

    expect(toastIsUp(container)).toBe(true)
    expect(toastText(container)).toBe(flagLines['1-1'])
    expect(game.grid.width).toBe(loadLevel('1-1').size[0])
    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(endCard(container).dataset.mode).toBe('playing')

    // And the beat still finishes: the inert Enter took nothing away from it.
    elapseFlagToast(game, container)
    expect(game.grid.width).toBe(loadLevel('1-2').size[0])
  })

  test('is not an end card: Space leaves the line up, and the browser cannot act on it', () => {
    const { container, game } = start()
    takeFlag(game, '1-1')

    const event = pressSpace(container)

    expect(event.defaultPrevented).toBe(true)
    expect(toastIsUp(container)).toBe(true)
    expect(game.grid.width).toBe(loadLevel('1-1').size[0])
  })
})

describe('taking the castle flag', () => {
  test('shows the castle line, with the run not won yet', () => {
    const { container, game } = start('#level=1-castle')

    takeFlag(game, '1-castle')

    expect(toastText(container)).toBe(flagLines['1-castle'])
    expect(endCard(container).dataset.mode).toBe('playing')
  })

  test('still wins the game once the beat is over', () => {
    const { container, game } = start('#level=1-castle')
    takeFlag(game, '1-castle')

    elapseFlagToast(game, container)

    expect(endCard(container).dataset.mode).toBe('win')
    expect(
      container.querySelector<HTMLElement>('[data-game-overlay-text]')?.textContent,
    ).toBe(WIN_TEXT)
    expect(toastIsUp(container)).toBe(false)
  })
})

describe('a level with no line', () => {
  test('shows nothing and advances on the touch frame, as it did before the toast', () => {
    const { container, game } = start('#level=x-1')

    takeFlag(game, 'x-1')

    expect(toastIsUp(container)).toBe(false)
    expect(toastText(container)).toBe('')
    // x-1 leads nowhere, so advancing off it ends the run — on that same frame.
    expect(endCard(container).dataset.mode).toBe('win')
  })
})
