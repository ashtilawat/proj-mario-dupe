import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJsonc = (relative: string) =>
  JSON.parse(readFileSync(resolve(root, relative), 'utf8').replace(/^\s*\/\/.*$/gm, ''))

describe('tsconfig', () => {
  test('enables strict mode', () => {
    expect(readJsonc('tsconfig.json').compilerOptions.strict).toBe(true)
  })
})

describe('package.json', () => {
  const pkg = readJsonc('package.json')

  test('builds with vite', () => {
    expect(pkg.scripts.build).toContain('vite build')
  })

  test('depends on three', () => {
    expect(pkg.dependencies.three).toBeTruthy()
  })

  test('pulls in no third-party physics engine', () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ')

    expect(deps).not.toMatch(/rapier|cannon|ammo/i)
  })
})

describe('folder stubs', () => {
  const dirs = ['engine', 'physics', 'render', 'entities', 'levels', 'ui', 'debug']

  test.each(dirs)('src/%s exposes an empty index module', async (dir) => {
    const stub = await import(`../src/${dir}/index.ts`)

    expect(stub).toBeDefined()
  })
})

describe('entity types stub', () => {
  test('is importable and declares no runtime entities', async () => {
    const types = await import('../src/entities/types')

    expect(Object.keys(types).filter((key) => key !== 'default')).toHaveLength(0)
  })
})

describe('static hosting', () => {
  test('Staticfile serves the built dist directory', () => {
    expect(readFileSync(resolve(root, 'Staticfile'), 'utf8')).toMatch(/^root:\s*dist$/m)
  })
})
