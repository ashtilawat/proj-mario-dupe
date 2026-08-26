import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  GAME_OVER_TEXT,
  NEXT_LEVEL,
  START_LEVEL,
  START_LIVES,
  WIN_TEXT,
  createFlags,
  startGame,
  type Game,
} from '../src/main'
import { loadLevel } from '../src/levels/index.ts'
import { elapseFlagToast } from './helpers/flag-toast.ts'

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

function start(size = { width: 800, height: 400 }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const game = startGame(container, () => stubRenderer() as unknown as THREE.WebGLRenderer, size)
  // T-028: the title card gates the sim until Enter, so a test run starts the way a player
  // starts one. With the card down, Enter belongs to the end overlay again — which is what
  // every `pressEnter` below is exercising.
  pressEnter(container)
  started = game
  return { container, game }
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

function endCard(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-game-overlay]')
  if (!element) throw new Error('no end-card overlay in the container')
  return element
}

function cardText(container: HTMLElement): string {
  return container.querySelector<HTMLElement>('[data-game-overlay-text]')?.textContent ?? ''
}

/** Drops the body clear of the level, still moving, as a real pit fall would. */
function fallInPit(game: Game): void {
  game.player.body.aabb.y = -10
  game.player.body.velocity.y = -12
  game.loop.tick(1 / 120)
}

/** The one death loop this game has: fall in the pit until the lives run out. */
function drainLives(game: Game): void {
  for (let i = 0; i < START_LIVES; i++) fallInPit(game)
}

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

/**
 * Take every flag from the start of the run to the last level NEXT_LEVEL knows about. World
 * 1 is fully registered now, so each flag before the castle's advances the run instead of
 * ending it — only the final flag in the chain can win.
 */
function winTheRun(game: Game): void {
  let id: string | undefined = START_LEVEL
  while (id !== undefined) {
    const flag = loadLevel(id).entities.find((e) => e.type === 'flag')
    if (!flag) throw new Error('no flag in level ' + id)
    game.player.body.aabb.x = flag.at[0]
    game.player.body.aabb.y = flag.at[1]
    game.loop.tick(1 / 120)
    // T-052: every flag holds its level for a beat before it advances, the castle's
    // included — the win card is on the far side of the last line, not of the last touch.
    elapseFlagToast(game)
    id = NEXT_LEVEL[id]
  }
}

describe('the end-card overlay', () => {
  test('is mounted but hidden while the game is being played', () => {
    const { container } = start()

    const card = endCard(container)
    expect(card.dataset.mode).toBe('playing')
    expect(card.style.display).toBe('none')
  })

  test('sits above the HUD, which owns z-index 10', () => {
    const { container } = start()

    const hud = container.querySelector<HTMLElement>('[data-hud-root]')
    expect(Number(endCard(container).style.zIndex)).toBeGreaterThan(Number(hud!.style.zIndex))
  })

  test('is taken out of the container again on dispose', () => {
    const { container, game } = start()
    started = null

    game.dispose()

    expect(container.querySelector('[data-game-overlay]')).toBeNull()
  })
})

describe('running out of lives', () => {
  test('shows GAME OVER once the last life is spent', () => {
    const { container, game } = start()

    drainLives(game)

    expect(game.hud.getState().lives).toBe(0)
    expect(endCard(container).dataset.mode).toBe('gameover')
    expect(endCard(container).style.display).not.toBe('none')
    expect(cardText(container)).toBe(GAME_OVER_TEXT)
  })

  test('freezes the simulation — nothing steps behind the card', () => {
    const { game } = start()
    drainLives(game)

    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x
    const playerX = game.player.body.aabb.x
    // A live simulation would carry this straight into the next step.
    game.player.body.velocity.x = 6

    for (let i = 0; i < 10; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).toBeCloseTo(walkerX, 5)
    expect(game.player.body.aabb.x).toBeCloseTo(playerX, 5)
    expect(game.hud.getState().lives).toBe(0)
  })

  test('keeps rendering the frozen frame', () => {
    const { game } = start()
    drainLives(game)

    expect(() => game.loop.tick(1 / 60)).not.toThrow()
    expect(game.loop.running).toBe(true)
  })
})

describe('restarting with Enter', () => {
  test('puts World 1-1 back at three lives, with the player on the spawn', () => {
    const { container, game } = start()
    const [spawnX, spawnY] = loadLevel(START_LEVEL).spawn
    drainLives(game)

    pressEnter(container)

    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(game.player.body.aabb.x).toBeCloseTo(spawnX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(spawnY, 5)
    expect(game.player.body.velocity.x).toBe(0)
    expect(game.player.body.velocity.y).toBe(0)
    expect(endCard(container).dataset.mode).toBe('playing')
    expect(endCard(container).style.display).toBe('none')
  })

  test('brings the walkers back to their level spawns', () => {
    const { container, game } = start()
    const dead = game.walkers[0]!
    dead.alive = false
    dead.stomped = true
    dead.mesh.visible = false
    drainLives(game)

    pressEnter(container)

    expect(game.walkers).toHaveLength(1)
    const walker = game.walkers[0]!
    expect(walker.alive).toBe(true)
    expect(walker.stomped).toBe(false)
    expect(walker.mesh.visible).toBe(true)
    expect(walker.aabb.x).toBeCloseTo(16, 5)
    expect(walker.aabb.y).toBeCloseTo(1, 5)
    expect(walker.dir).toBe(-1)
  })

  test('runs the simulation again once the card is gone', () => {
    const { container, game } = start()
    drainLives(game)
    pressEnter(container)

    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x
    for (let i = 0; i < 10; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).not.toBeCloseTo(walkerX, 5)
  })

  test('does nothing while the game is still being played', () => {
    const { container, game } = start()
    game.player.body.aabb.x = 8

    pressEnter(container)

    expect(game.player.body.aabb.x).toBeCloseTo(8, 5)
    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(endCard(container).dataset.mode).toBe('playing')
  })

  test('ignores keys that are not Enter', () => {
    const { container, game } = start()
    drainLives(game)

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

    expect(game.hud.getState().lives).toBe(0)
    expect(endCard(container).dataset.mode).toBe('gameover')
  })
})

describe('the checkpoint', () => {
  test('catches the pit fall once the player has passed it', () => {
    const { game } = start()
    const [checkpointX, checkpointY] = loadLevel(START_LEVEL).checkpoint
    game.player.body.aabb.x = checkpointX + 1

    fallInPit(game)

    expect(game.player.body.aabb.x).toBeCloseTo(checkpointX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(checkpointY, 5)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)
  })

  test('is not used before the player reaches it', () => {
    const { game } = start()
    const [spawnX, spawnY] = loadLevel(START_LEVEL).spawn
    game.player.body.aabb.x = 5

    fallInPit(game)

    expect(game.player.body.aabb.x).toBeCloseTo(spawnX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(spawnY, 5)
  })

  test('is unlatched again by a restart', () => {
    const { container, game } = start()
    const [spawnX, spawnY] = loadLevel(START_LEVEL).spawn
    const [checkpointX] = loadLevel(START_LEVEL).checkpoint

    // Cross the checkpoint, then die out and restart: the fresh run starts unlatched.
    game.player.body.aabb.x = checkpointX + 1
    game.loop.tick(1 / 120)
    drainLives(game)
    pressEnter(container)

    game.player.body.aabb.x = 5
    fallInPit(game)

    expect(game.player.body.aabb.x).toBeCloseTo(spawnX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(spawnY, 5)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)
  })
})

describe('the flag', () => {
  test('reads one AABB per flag entity, on the walker convention', () => {
    const flags = createFlags(loadLevel(START_LEVEL))

    expect(flags).toEqual([{ x: 22, y: 1, w: 1, h: 1 }])
  })

  test('chains World 1 from 1-1 to the castle, which leads nowhere', () => {
    expect(NEXT_LEVEL[START_LEVEL]).toBe('1-2')
    expect(NEXT_LEVEL['1-2']).toBe('1-3')
    expect(NEXT_LEVEL['1-3']).toBe('1-4')
    expect(NEXT_LEVEL['1-4']).toBe('1-5')
    expect(NEXT_LEVEL['1-5']).toBe('1-6')
    expect(NEXT_LEVEL['1-6']).toBe('1-castle')
    expect(NEXT_LEVEL['1-castle']).toBeUndefined()
  })

  test('wins the game on the last flag in the chain', () => {
    const { container, game } = start()

    winTheRun(game)

    expect(endCard(container).dataset.mode).toBe('win')
    expect(cardText(container)).toBe(WIN_TEXT)
  })

  test('freezes the simulation behind the win card', () => {
    const { game } = start()
    winTheRun(game)

    const walker = game.walkers[0]!
    const walkerX = walker.aabb.x
    for (let i = 0; i < 10; i++) game.loop.tick(1 / 60)

    expect(walker.aabb.x).toBeCloseTo(walkerX, 5)
  })

  test('Enter after a win restarts World 1-1 at three lives', () => {
    const { container, game } = start()
    const [spawnX, spawnY] = loadLevel(START_LEVEL).spawn
    fallInPit(game)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)

    winTheRun(game)
    expect(endCard(container).dataset.mode).toBe('win')

    pressEnter(container)

    expect(game.hud.getState().lives).toBe(START_LIVES)
    expect(game.player.body.aabb.x).toBeCloseTo(spawnX, 5)
    expect(game.player.body.aabb.y).toBeCloseTo(spawnY, 5)
    expect(endCard(container).dataset.mode).toBe('playing')
  })
})

/**
 * T-046. Space is the jump key and nothing else: it must never answer an end card. QA saw
 * Space "dismiss" GAME OVER, and the keydown path here proves it never restarts — what it
 * did do was leave the event cancelable, so the browser ran its own default for Space
 * (scrolling the frame, or firing whatever control had focus) over a card the game still
 * considered up. Both halves are pinned below: inert, AND cancelled.
 *
 * `key: ' '` gets its own case because a keyboard layout, a synthetic press or an IME can
 * deliver a Space with no `code` at all, and that shape must not slip past the guard into
 * the key-matching below it.
 */
function pressSpace(container: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  container.dispatchEvent(event)
  return event
}

/** The two shapes a Space keydown arrives in. Neither may reach the end cards. */
const SPACE_KEYS: readonly (readonly [string, KeyboardEventInit])[] = [
  ['code Space', { key: ' ', code: 'Space' }],
  ['bare key', { key: ' ' }],
]

describe('Space on an end card', () => {
  for (const [shape, init] of SPACE_KEYS) {
    test(`leaves GAME OVER up — ${shape}`, () => {
      const { container, game } = start()
      drainLives(game)

      pressSpace(container, init)

      expect(game.hud.getState().lives).toBe(0)
      expect(endCard(container).dataset.mode).toBe('gameover')
      expect(endCard(container).style.display).not.toBe('none')
      expect(cardText(container)).toBe(GAME_OVER_TEXT)
    })

    test(`is cancelled on GAME OVER, so the browser cannot act on it — ${shape}`, () => {
      const { container, game } = start()
      drainLives(game)

      expect(pressSpace(container, init).defaultPrevented).toBe(true)
    })

    test(`leaves YOU WIN up — ${shape}`, () => {
      const { container, game } = start()
      winTheRun(game)

      pressSpace(container, init)

      expect(endCard(container).dataset.mode).toBe('win')
      expect(endCard(container).style.display).not.toBe('none')
      expect(cardText(container)).toBe(WIN_TEXT)
    })

    test(`is cancelled on YOU WIN — ${shape}`, () => {
      const { container, game } = start()
      winTheRun(game)

      expect(pressSpace(container, init).defaultPrevented).toBe(true)
    })

    test(`is cancelled while the title card is still up — ${shape}`, () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      started = startGame(
        container,
        () => stubRenderer() as unknown as THREE.WebGLRenderer,
        { width: 800, height: 400 },
      )

      expect(pressSpace(container, init).defaultPrevented).toBe(true)
    })

    test(`does not spend the Enter that restarts the run — ${shape}`, () => {
      const { container, game } = start()
      drainLives(game)
      pressSpace(container, init)

      pressEnter(container)

      expect(game.hud.getState().lives).toBe(START_LIVES)
      expect(endCard(container).dataset.mode).toBe('playing')
      expect(endCard(container).style.display).toBe('none')
    })
  }

  test('still jumps during a live run', () => {
    const { container, game } = start()
    // On the ground, at rest: the only thing that can lift it is the jump key.
    game.loop.tick(1 / 120)
    const groundY = game.player.body.aabb.y

    pressSpace(container, { key: ' ', code: 'Space' })
    game.loop.tick(1 / 120)

    expect(game.player.body.velocity.y).toBeGreaterThan(0)
    expect(game.player.body.aabb.y).toBeGreaterThan(groundY)
  })
})
