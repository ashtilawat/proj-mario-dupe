import type { Level } from './types.ts'
import world11 from './data/1-1.json'
import world12 from './data/1-2.json'
import world13 from './data/1-3.json'
import world14 from './data/1-4.json'
import world15 from './data/1-5.json'
import world16 from './data/1-6.json'
import world1Castle from './data/1-castle.json'

const levels: Record<string, Level> = {
  '1-1': world11 as unknown as Level,
  '1-2': world12 as unknown as Level,
  '1-3': world13 as unknown as Level,
  '1-4': world14 as unknown as Level,
  '1-5': world15 as unknown as Level,
  '1-6': world16 as unknown as Level,
  '1-castle': world1Castle as unknown as Level,
}

export function loadLevel(id: string): Level {
  const level = levels[id]
  if (!level) throw new Error("Unknown level: " + id)
  return level
}
