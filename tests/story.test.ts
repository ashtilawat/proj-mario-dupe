import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import * as story from '../src/story/index.ts'
import { WORLD_1_LEVEL_IDS, flagLines, tagline, title } from '../src/story/index.ts'

describe('title and tagline', () => {
  test('the game has its name', () => {
    expect(title).toBe('Pip and the Paper Hills')
  })

  test('the tagline is the approved line', () => {
    expect(tagline).toBe('Carry the lantern home, one hop at a time.')
  })

  test('both are trimmed, non-empty, and short enough for an overlay', () => {
    for (const [name, value] of [
      ['title', title],
      ['tagline', tagline],
    ] as const) {
      expect(value, name).toBe(value.trim())
      expect(value.length, name).toBeGreaterThan(0)
    }
    expect(title.length).toBeLessThanOrEqual(40)
    expect(tagline.length).toBeLessThanOrEqual(60)
  })
})

describe('flagLines shape', () => {
  test('is exactly the seven World 1 ids, in play order', () => {
    expect(Object.keys(flagLines)).toEqual([
      '1-1',
      '1-2',
      '1-3',
      '1-4',
      '1-5',
      '1-6',
      '1-castle',
    ])
  })

  test('WORLD_1_LEVEL_IDS is the same list, so the two cannot drift apart', () => {
    expect([...WORLD_1_LEVEL_IDS]).toEqual(Object.keys(flagLines))
    expect(WORLD_1_LEVEL_IDS).toHaveLength(7)
  })
})

describe('flag line copy', () => {
  test('each level gets its approved line', () => {
    expect(flagLines).toEqual({
      '1-1': 'One hill down, Pip. The lantern is still lit.',
      '1-2': 'Past the wobblers! The paper hills roll on.',
      '1-3': 'Through the dark cave, and the lantern held on.',
      '1-4': 'Back in the sunshine. Shake off that cave dust!',
      '1-5': 'Up where the clouds nap. Castle towers ahead!',
      '1-6': 'The paper king left the gate open. Almost home!',
      '1-castle': 'The lantern is home, Pip. World 2 is waking up.',
    })
  })

  test('the copy tells one arc a kid can follow: a lantern, a cave, then home', () => {
    // The landmarks, not the wording — copy can be punched up again without touching this,
    // but the arc cannot quietly lose the cave in the middle or the homecoming at the end.
    expect(tagline).toMatch(/lantern/i)
    expect(flagLines['1-3']).toMatch(/cave/i)
    expect(flagLines['1-castle']).toMatch(/home/i)
  })

  test('every line is short, trimmed, and closes cleanly', () => {
    for (const id of WORLD_1_LEVEL_IDS) {
      const line = flagLines[id]
      expect(line, id).toBe(line.trim())
      expect(line.length, id).toBeGreaterThan(0)
      expect(line.length, id).toBeLessThanOrEqual(60)
      expect(line, id).toMatch(/[.!?]$/)
    }
  })

  test('no two levels reuse the same line', () => {
    expect(new Set(Object.values(flagLines)).size).toBe(7)
  })
})

const ALL_COPY = [title, tagline, ...Object.values(flagLines)]

const SOURCE_FILES = ['world1.ts', 'index.ts'] as const

function sourceOf(name: string): string {
  // jsdom's global URL constructor mis-resolves relative specifiers against a file:// base
  // (falls back to the document's http://localhost base instead), so build an absolute
  // URL string ourselves rather than passing a relative specifier to `new URL(rel, base)`.
  const testDir = import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))
  return readFileSync(new URL(`${testDir}/../src/story/${name}`), 'utf8')
}

describe('the copy is original and kid-friendly', () => {
  test('borrows no trademarked character names', () => {
    for (const line of ALL_COPY) {
      expect(line, line).not.toMatch(
        /\b(mario|luigi|peach|bowser|koopa|goomba|yoshi|toad|nintendo)\b/i,
      )
    }
  })

  test('uses no violent or unkind vocabulary', () => {
    for (const line of ALL_COPY) {
      expect(line, line).not.toMatch(
        /\b(kill|kills|killed|die|dies|died|dead|death|blood|hate|hates|stupid|dumb)\b/i,
      )
    }
  })

  test('never shouts', () => {
    for (const line of ALL_COPY) {
      expect(line, line).not.toBe(line.toUpperCase())
    }
  })
})

describe('the module stays pure data', () => {
  test('exports exactly the four approved values and nothing else', () => {
    expect(Object.keys(story).sort()).toEqual([
      'WORLD_1_LEVEL_IDS',
      'flagLines',
      'tagline',
      'title',
    ])
  })

  test('no export is a function', () => {
    for (const [name, value] of Object.entries(story)) {
      expect(typeof value, name).not.toBe('function')
      expect(['string', 'object'], name).toContain(typeof value)
    }
  })

  test('the source names no browser or engine runtime', () => {
    for (const file of SOURCE_FILES) {
      expect(sourceOf(file), file).not.toMatch(
        /\b(document|window|globalThis|addEventListener|removeEventListener|requestAnimationFrame|setTimeout|setInterval|fetch|THREE)\b/,
      )
    }
  })

  test('imports nothing from outside src/story, so importing it can have no side effects', () => {
    // Both `import x from 'y'` / `export { x } from 'y'` and bare `import 'y'`.
    const specifiers = /(?:\bfrom\s*|^\s*import\s*)['"]([^'"]+)['"]/gm

    for (const file of SOURCE_FILES) {
      const found = [...sourceOf(file).matchAll(specifiers)].map((m) => m[1])
      for (const specifier of found) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\//)
      }
    }

    // The barrel does import something, so a regex that silently matches nothing would
    // pass the loop above vacuously. Prove it finds the real import.
    expect([...sourceOf('index.ts').matchAll(specifiers)].length).toBeGreaterThan(0)
  })
})
