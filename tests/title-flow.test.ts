/**
 * T-028 — the title card as the run's gate.
 *
 * `src/ui/title.ts` is deliberately inert: it binds no listeners and knows nothing about
 * Enter. Everything asserted here is main.ts's wiring around it — who shows it, what
 * freezes behind it, and how it shares the Enter key with the T-022 end card.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { START_LIVES, startGame, type Game } from '../src/main'

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

/** Deliberately does NOT dismiss the title — that is what this file is testing. */
function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

function titleCard(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-title-root]')
  if (!element) throw new Error('no title card in the container')
  return element
}

function endCard(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-game-overlay]')
  if (!element) throw new Error('no end-card overlay in the container')
  return element
}

/** Drops the body clear of the level, still moving, as a real pit fall would. */
function fallInPit(game: Game): void {
  game.player.body.aabb.y = -10
  game.player.body.velocity.y = -12
  game.loop.tick(1 / 120)
}

describe('the title card on boot', () => {
  test('is mounted into the container and visible before anything is pressed', () => {
    const { container, game } = start()

    expect(container.contains(titleCard(container))).toBe(true)
    expect(game.title.visible).toBe(true)
    expect(titleCard(container).dataset.titleVisible).toBe('true')
    expect(titleCard(container).style.display).not.toBe('none')
  })

  test('stacks above the HUD so the curtain covers the whole frame', () => {
    const { container } = start()

    const hud = container.querySelector<HTMLElement>('[data-hud-root]')!
    expect(hud.style.zIndex).not.toBe('')
    expect(titleCard(container).style.zIndex).not.toBe('')
    expect(Number(titleCard(container).style.zIndex)).toBeGreaterThan(Number(hud.style.zIndex))
  })

  test('is taken out of the container again on dispose', () => {
    const { container, game } = start()
    started = null

    game.dispose()

    expect(container.querySelector('[data-title-root]')).toBeNull()
  })
})

describe('the frozen sim behind the title', () => {
  test('leaves the walkers parked on their spawns however long the loop runs', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x

    for (let i = 0; i < 60; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).toBeCloseTo(walkerX, 5)
  })

  test('never steps the player — not even to settle them onto the floor', () => {
    const { game } = start()
    // A live simulation would carry this straight into the next step.
    game.player.body.velocity.x = 6

    for (let i = 0; i < 60; i++) game.loop.tick(1 / 60)

    expect(game.player.body.aabb.x).toBeCloseTo(2, 5)
    expect(game.player.grounded).toBe(false)
  })

  test('keeps rendering the frozen frame', () => {
    const { game } = start()

    expect(() => game.loop.tick(1 / 60)).not.toThrow()
    expect(game.loop.running).toBe(true)
  })

  test('cannot lose a life to the pit while the card is still up', () => {
    const { game } = start()

    fallInPit(game)

    expect(game.hud.getState().lives).toBe(START_LIVES)
  })
})

describe('Enter on the title', () => {
  test('hides the card', () => {
    const { container, game } = start()

    pressEnter(container)

    expect(game.title.visible).toBe(false)
    expect(titleCard(container).dataset.titleVisible).toBe('false')
    expect(titleCard(container).style.display).toBe('none')
  })

  test('starts the run — the world steps from the next tick on', () => {
    const { container, game } = start()
    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x

    pressEnter(container)
    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).toBeLessThan(walkerX)
    expect(game.player.grounded).toBe(true)
  })

  test('ignores keys that are not Enter', () => {
    const { container, game } = start()

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

    expect(game.title.visible).toBe(true)
  })

  test('does not raise an end card — the run starts playing, not finished', () => {
    const { container } = start()

    pressEnter(container)

    expect(endCard(container).dataset.mode).toBe('playing')
    expect(endCard(container).style.display).toBe('none')
  })
})

describe('sharing Enter with the T-022 end card', () => {
  test('a second Enter while playing does nothing', () => {
    const { container, game } = start()
    pressEnter(container)
    game.player.body.aabb.x = 8

    pressEnter(container)

    expect(game.player.body.aabb.x).toBeCloseTo(8, 5)
    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(endCard(container).dataset.mode).toBe('playing')
  })

  test('Enter still restarts from a GAME OVER card once the title is gone', () => {
    const { container, game } = start()
    pressEnter(container)
    for (let i = 0; i < START_LIVES; i++) fallInPit(game)
    expect(endCard(container).dataset.mode).toBe('gameover')

    pressEnter(container)

    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(endCard(container).dataset.mode).toBe('playing')
  })

  test('a restart goes straight back into play rather than back to the title', () => {
    const { container, game } = start()
    pressEnter(container)
    for (let i = 0; i < START_LIVES; i++) fallInPit(game)

    pressEnter(container)
    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x
    for (let i = 0; i < 30; i++) game.loop.tick(1 / 60)

    expect(game.title.visible).toBe(false)
    expect(walker.aabb.x).toBeLessThan(walkerX)
  })
})
