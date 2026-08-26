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

/**
 * Boots a run the way `main` does — with the title card still up, because the warp is the
 * level the boot frame is frozen on and every test here wants to see it before Enter.
 */
function start() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(
    container,
    () => stubRenderer() as unknown as THREE.WebGLRenderer,
    { width: 800, height: 400 },
  )
  started = game
  return { container, game }
}

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

/** Drops the body clear of the level, still moving, as a real pit fall would. */
function fallInPit(game: Game): void {
  game.player.body.aabb.y = -10
  game.player.body.velocity.y = -12
  game.loop.tick(1 / 120)
  game.loop.tick(1 / 120)
}

/** Sets the hash and warps the way a browser does: address bar first, then the event. */
function warpTo(hash: string): void {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
  // The hash is global to the jsdom window, so a test that leaves one set would boot every
  // later file's `startGame` into the wrong level.
  window.location.hash = ''
})

describe('booting from #level=<id>', () => {
  test('boots the castle, boss and all, when the URL asks for it', () => {
    window.location.hash = '#level=1-castle'

    const { game } = start()

    expect(game.grid.width).toBe(18)
    expect(game.bosses.length).toBe(1)
  })

  test('leaves the title card up over the warped-in level', () => {
    window.location.hash = '#level=1-castle'

    const { game } = start()

    expect(game.title.visible).toBe(true)
  })

  test('boots 1-3 when the URL asks for it', () => {
    window.location.hash = '#level=1-3'

    const { game } = start()

    expect(game.grid.width).toBe(28)
  })

  for (const hash of ['', '#', '#foo', '#level=nope', '#level=2-1']) {
    test(`stays on 1-1 for ${hash === '' ? 'a missing hash' : hash}`, () => {
      window.location.hash = hash

      const { game } = start()

      expect(game.grid.width).toBe(24)
      expect(game.bosses.length).toBe(0)
    })
  }
})

describe('hashchange mid-run', () => {
  test('warps to the level the new hash names', () => {
    const { game } = start()
    expect(game.grid.width).toBe(24)

    warpTo('#level=1-castle')

    expect(game.grid.width).toBe(18)
    expect(game.bosses.length).toBe(1)
  })

  test('warps after the title is down too', () => {
    const { container, game } = start()
    pressEnter(container)

    warpTo('#level=1-3')

    expect(game.grid.width).toBe(28)
  })

  test('ignores a hash the loader does not know, leaving the level alone', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()

    warpTo('#level=nope')

    // Back to 1-1 rather than stuck on the castle: an unreadable hash means START_LEVEL.
    expect(game.grid.width).toBe(24)
  })

  test('stops listening once the game is disposed', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()
    started = null
    game.dispose()

    warpTo('#level=1-3')

    expect(game.grid.width).toBe(18)
  })
})

describe('restart after a hash boot', () => {
  test('GAME OVER Enter returns to 1-1, not to the hash level', () => {
    window.location.hash = '#level=1-castle'
    const { container, game } = start()
    pressEnter(container)
    expect(game.grid.width).toBe(18)

    for (let i = 0; i < START_LIVES; i++) fallInPit(game)
    expect(game.hud.getState().lives).toBe(0)
    pressEnter(container)

    expect(game.grid.width).toBe(24)
    expect(game.bosses.length).toBe(0)
  })
})
