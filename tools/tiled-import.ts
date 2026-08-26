import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { convertTiledMap, type TiledMap } from '../src/levels/tiled.ts'

export { encodeTiles, decodeTiles } from '../src/levels/rle.ts'
export { convertTiledMap } from '../src/levels/tiled.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = join(root, 'assets', 'levels')
const outDir = join(root, 'src', 'levels', 'data')

function isTiledMap(raw: unknown): raw is TiledMap {
  if (typeof raw !== "object" || raw === null) return false
  const m = raw as { layers?: unknown; width?: unknown; height?: unknown }
  return Array.isArray(m.layers) && typeof m.width === "number" && typeof m.height === "number"
}

export function importAll(): string[] {
  mkdirSync(outDir, { recursive: true })
  const written: string[] = []
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith(".json")) continue
    const raw = JSON.parse(readFileSync(join(assetsDir, name), "utf8")) as unknown
    if (!isTiledMap(raw)) continue
    const id = name.slice(0, -5)
    const level = convertTiledMap(raw, id)
    const dest = join(outDir, level.id + ".json")
    writeFileSync(dest, JSON.stringify(level, null, 2) + "\n")
    written.push(dest)
  }
  return written
}

function isCli(): boolean {
  const argv = process.argv[1]
  if (!argv) return false
  return pathToFileURL(argv).href === import.meta.url
}

if (isCli()) {
  const written = importAll()
  for (const dest of written) console.log("wrote " + dest)
}
