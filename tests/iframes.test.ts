// T-037 — i-frame billing: one unbroken contact with a walker costs exactly one life.
//
// The bug this file exists for was found and measured by T-034, which was fenced to
// walker.ts and reported it back rather than fixing it. `invuln` in main.ts is a plain 1 s
// wall-clock timer, not scoped to the contact that armed it. The 1-1 walker's ledge turn
// (hasGroundAhead looks a full tile ahead, so the leftward walker reverses at x ~ 12.983)
// keeps it inside a standing player for ~1.5 s without ever breaking overlap — so the window
// expires mid-contact and the SAME bump bills again, and again, to GAME OVER.
//
// These tests drive the real game loop. Nothing is mocked but the WebGL renderer.

import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { START_LIVES, startGame, type Game } from '../src/main'
import { STOMP_BOUNCE, overlaps } from '../src/physics/index.ts'
import { createWalker } from '../src/entities/enemies/walker.ts'

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
  // starts one. The card itself is covered by tests/title-flow.test.ts.
  pressEnter(container)
  started = game
  return { container, game }
}

function pressEnter(container: HTMLElement): void {
  container.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

afterEach(() => {
  started?.dispose()
  started = null
  document.body.replaceChildren()
})

/** Park the player at rest on the 1-1 floor, in the walker's path. */
function standAt(game: Game, x: number): void {
  game.player.body.aabb.x = x
  game.player.body.aabb.y = 1
  game.player.body.velocity.x = 0
  game.player.body.velocity.y = 0
}

const STEP = 1 / 120

describe('one unbroken contact bills one life', () => {
  /**
   * The T-034 repro, verbatim: standing at x = 13.8 the walker walks in, turns on the pit
   * rim, and walks back out across ONE 1.525 s overlap — billing at 0.750 s and again at
   * 1.758 s once the plain 1 s timer lapsed. x ~ 13.3-14.7 is where the player lands after
   * jumping the pit, and the checkpoint is at x = 12, so this is the golden path.
   *
   * The loop watches the overlap itself rather than trusting the timings: the assertion is
   * that no life is billed while the FIRST contact is still unbroken, whatever its length.
   */
  test('does not bill again when the window lapses mid-overlap (x = 13.8)', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    standAt(game, 13.8)

    let contacted = false
    let livesWhenContactBroke = -1
    for (let i = 0; i < 300; i += 1) {
      game.loop.tick(STEP)
      const touching = overlaps(game.player.body.aabb, walker.aabb)
      if (touching) contacted = true
      if (contacted && !touching) {
        livesWhenContactBroke = game.hud.getState().lives
        break
      }
    }

    // The contact happened and ended, so the window really did lapse inside it.
    expect(contacted).toBe(true)
    expect(livesWhenContactBroke).toBe(START_LIVES - 1)
  })
})

describe('a bump that catches several walkers at once', () => {
  /**
   * A duplicate of the 1-1 walker, spawned on the same tile facing the same way. Walkers
   * only collide against tiles, never each other or the player, so the two step in lockstep
   * and share one contact window — which is what makes this deterministic. `walkers` is the
   * very array `simulate` iterates, so pushing onto it is enough.
   */
  function addTwinWalker(game: Game) {
    const twin = createWalker({ x: 16, y: 1, dir: -1, id: 1 })
    game.walkers.push(twin)
    return twin
  }

  test('bills one life for two walkers, and neither bills again mid-overlap', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    const twin = addTwinWalker(game)
    standAt(game, 13.8)

    let contacted = false
    let livesWhenContactBroke = -1
    for (let i = 0; i < 300; i += 1) {
      game.loop.tick(STEP)
      const touching = overlaps(game.player.body.aabb, walker.aabb)
      if (touching) contacted = true
      if (contacted && !touching) {
        livesWhenContactBroke = game.hud.getState().lives
        break
      }
    }

    // Both were caught by the same bump, so the twin is latched by it even though the
    // i-frames swallowed its bill. Latching only the walker that actually paid would let
    // the twin charge a second life the moment the window lapsed, ~1 s into the contact.
    expect(contacted).toBe(true)
    expect(twin.alive).toBe(true)
    expect(livesWhenContactBroke).toBe(START_LIVES - 1)
  })
})

describe('what the latch must not swallow', () => {
  test('bills again for a later, separate contact', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    standAt(game, 16.2)

    // The walker leaves and comes back off its pit-rim turn; T-034 measured the second
    // touch at ~2.6 s. Tracking the overlap itself keeps this off that exact number.
    let separated = false
    let touchedAgain = false
    for (let i = 0; i < 420 && !touchedAgain; i += 1) {
      game.loop.tick(STEP)
      const touching = overlaps(game.player.body.aabb, walker.aabb)
      if (!touching) separated = true
      else if (separated) touchedAgain = true
    }

    expect(separated).toBe(true)
    expect(touchedAgain).toBe(true)
    expect(game.hud.getState().lives).toBe(START_LIVES - 2)
  })

  test('still stomps, and a stomp is not a side hit', () => {
    const { game } = start()
    const walker = game.walkers[0]!
    game.player.body.aabb.x = 16.2
    game.player.body.aabb.y = 2
    game.player.body.velocity.x = 0
    game.player.body.velocity.y = -6

    game.loop.tick(STEP)

    expect(walker.alive).toBe(false)
    expect(walker.mesh.visible).toBe(false)
    expect(game.player.body.velocity.y).toBe(STOMP_BOUNCE)
    expect(game.hud.getState().lives).toBe(START_LIVES)
  })

  test('still bills the pit while the i-frames from a bump are running', () => {
    const { game } = start()
    standAt(game, 16.2)

    game.loop.tick(STEP)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)

    // Inside the 1 s window the bump just armed. The pit has never consulted `invuln` and
    // does not consult the latch either — falling out of the level always costs a life.
    game.player.body.aabb.y = -10
    game.player.body.velocity.y = -12
    game.loop.tick(STEP)

    expect(game.hud.getState().lives).toBe(START_LIVES - 2)
  })

  test('lets the same walker bill again after an Enter restart', () => {
    const { container, game } = start()
    standAt(game, 16.2)
    game.loop.tick(STEP)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)

    // Out of lives, then Enter: a fresh run on fresh walkers, and the same bump bills again.
    // (The latch is already released here — the pit falls below take the player out of the
    // walker. Carrying a latch THROUGH a level change is pinned by the test below.)
    for (let i = 0; i < START_LIVES; i += 1) {
      game.player.body.aabb.y = -10
      game.player.body.velocity.y = -12
      game.loop.tick(STEP)
    }
    pressEnter(container)
    expect(game.hud.getState().lives).toBe(START_LIVES)

    standAt(game, 16.2)
    game.loop.tick(STEP)

    expect(game.hud.getState().lives).toBe(START_LIVES - 1)
  })

  /**
   * The one path that can cross a level boundary with a contact still latched: taking the
   * flag while a walker is on top of you. `applyLevel` throws every walker away, so every
   * latched contact is over by definition — and the next level's walker 0 must be able to
   * bill even though it inherits the id the latched one had.
   */
  test('does not carry a latched contact into the next level', () => {
    const { game } = start()
    // A walker sitting on 1-1's flag, wearing the id the next level's first walker will get.
    game.walkers.push(createWalker({ x: 22, y: 1, dir: 1, id: 0 }))
    standAt(game, 22.2)

    // One tick: the walker bills and latches, then the flag underneath advances the run.
    game.loop.tick(STEP)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)

    // Alone on the new level, long enough for the flag bump's i-frames to lapse.
    game.walkers.splice(0, game.walkers.length)
    for (let i = 0; i < 150; i += 1) game.loop.tick(STEP)
    expect(game.hud.getState().lives).toBe(START_LIVES - 1)

    // A brand-new walker, on the same id, right on top of the player.
    const aabb = game.player.body.aabb
    game.walkers.push(createWalker({ x: aabb.x, y: aabb.y, dir: 1, id: 0 }))
    game.loop.tick(STEP)

    expect(game.hud.getState().lives).toBe(START_LIVES - 2)
  })
})
