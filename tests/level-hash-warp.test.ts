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

    // T-048: still the castle. A hash naming no level the loader knows is not an instruction
    // to go anywhere — it used to mean START_LEVEL, which is what turned a stripped hash on
    // a warped run into 1-1. Boot still falls back to 1-1; a warp no longer does.
    expect(game.grid.width).toBe(18)
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

/**
 * T-048. Live, `#level=1-castle` booted the castle and then came back as 1-1 grass with the
 * hash gone from the address bar. Nothing in this bundle writes `location.hash` — the only
 * `window.location` in the whole of src is the read in `hashLevel` — so whatever strips it
 * is outside the game: the shell the page is embedded in, an extension, the host. What the
 * game did with that strip is the bug, and it is entirely ours: the boot read the hash at
 * the very END of `startGame`, long after the renderer was built, and `onHashChange` mapped
 * every empty or unknown hash onto START_LEVEL. One strip, and a warped run was 1-1.
 *
 * So the level a run boots on is now frozen from a snapshot taken before anything else runs,
 * and a hash that names no level it knows is not a warp instruction at all.
 */

/** Boots like `start`, running `onBoot` from inside the renderer factory — mid-`startGame`. */
function startDuring(onBoot: () => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(
    container,
    () => {
      onBoot()
      return stubRenderer() as unknown as THREE.WebGLRenderer
    },
    { width: 800, height: 400 },
  )
  started = game
  return { container, game }
}

/** A strip: the hash goes away, and the browser tells the page about it. */
function stripHash(): void {
  window.location.hash = ''
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

describe('a hash stripped out from under a warped run', () => {
  test('boots the level the URL named even if the hash is gone by the time the world loads', () => {
    window.location.hash = '#level=1-castle'

    const { game } = startDuring(() => {
      window.location.hash = ''
    })

    expect(game.grid.width).toBe(18)
    expect(game.bosses.length).toBe(1)
  })

  test('keeps the warped level when the hash is stripped after boot', () => {
    window.location.hash = '#level=1-castle'
    const { game } = start()

    stripHash()

    expect(game.grid.width).toBe(18)
    expect(game.bosses.length).toBe(1)
  })

  test('puts the stripped hash back in the address bar', () => {
    window.location.hash = '#level=1-castle'
    start()

    stripHash()

    expect(window.location.hash).toContain('1-castle')
  })

  test('keeps the warped level, and the hash, across the Enter that starts the run', () => {
    window.location.hash = '#level=1-castle'
    const { container, game } = start()

    pressEnter(container)

    expect(game.grid.width).toBe(18)
    expect(game.bosses.length).toBe(1)
    expect(window.location.hash).toContain('1-castle')
  })

  test('leaves a plain 1-1 run on 1-1, and names it in the bar', () => {
    const { game } = start()

    warpTo('#nonsense')

    expect(game.grid.width).toBe(24)
    // 1-1 restores like every other level. A bare bar is what a reload of `/` boots from,
    // and 1-1 is exactly where the GAME OVER card lives — see the card test below.
    expect(window.location.hash).toContain('level=1-1')
  })
})

/**
 * T-048, second half. QA then saw GAME OVER on 1-1 throw itself back to the TITLE about half
 * a second after it came up, with nobody touching a key. A full load of `/` — no hash — boots
 * exactly that: title card, 1-1 underneath. Same strip, one step further along.
 *
 * The first cut of this fix returned early on 1-1 rather than restoring, on the grounds that
 * a bare URL is where 1-1 boots from anyway and there was no hash to invent. That is the one
 * case where it matters most: 1-1 is where every GAME OVER sits. So every level restores now,
 * 1-1 included, and a strip does nothing else at all — it does not load a level, does not
 * raise the title, does not restart the run. The card stays exactly as the player left it.
 */
function endCard(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-game-overlay]')
  if (!element) throw new Error('no end-card overlay in the container')
  return element
}

describe('a hash stripped while GAME OVER is up on 1-1', () => {
  /** A run played from the title down to a dead stop on 1-1, the way QA reached it. */
  function gameOverOn1_1(hash: string) {
    window.location.hash = hash
    const { container, game } = start()
    pressEnter(container)
    for (let i = 0; i < START_LIVES; i++) fallInPit(game)
    expect(game.hud.getState().lives).toBe(0)
    expect(endCard(container).dataset.mode).toBe('gameover')
    return { container, game }
  }

  for (const hash of ['', '#level=1-1']) {
    const from = hash === '' ? 'a bare URL' : hash

    test(`leaves the card up, booted from ${from}`, () => {
      const { container } = gameOverOn1_1(hash)

      stripHash()

      expect(endCard(container).dataset.mode).toBe('gameover')
      expect(endCard(container).style.display).not.toBe('none')
    })

    test(`does not restart the run, booted from ${from}`, () => {
      const { game } = gameOverOn1_1(hash)

      stripHash()

      expect(game.hud.getState().lives).toBe(0)
    })

    test(`leaves the title down, booted from ${from}`, () => {
      const { game } = gameOverOn1_1(hash)

      stripHash()

      expect(game.title.visible).toBe(false)
    })

    test(`keeps 1-1 loaded and names it in the bar, booted from ${from}`, () => {
      const { game } = gameOverOn1_1(hash)

      stripHash()

      expect(game.grid.width).toBe(24)
      expect(window.location.hash).toContain('1-1')
    })
  }
})
