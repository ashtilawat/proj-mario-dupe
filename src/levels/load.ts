import type { Level } from './types.ts'
import world11 from './data/1-1.json'

const levels: Record<string, Level> = {
  '1-1': world11 as unknown as Level,
}

export function loadLevel(id: string): Level {
  const level = levels[id]
  if (!level) throw new Error("Unknown level: " + id)
  return level
}
