import { encodeTiles } from './rle.ts'
import type { Level, LevelEntity, Vec2 } from './types.ts'

interface TiledProperty {
  name: string
  type?: string
  value: unknown
}

interface TiledObject {
  name?: string
  type?: string
  x: number
  y: number
  width?: number
  height?: number
  properties?: TiledProperty[]
}

interface TiledLayer {
  type: string
  name?: string
  data?: number[]
  objects?: TiledObject[]
}

export interface TiledMap {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  properties?: TiledProperty[]
  layers: TiledLayer[]
}

function prop(props: TiledProperty[] | undefined, name: string): unknown {
  return props?.find((p) => p.name === name)?.value
}

function objectKind(obj: TiledObject): string {
  const t = (obj.type || obj.name || "").toLowerCase()
  if (t === "goal") return "flag"
  return t
}

function toTileYUp(map: TiledMap, pixelX: number, pixelY: number): Vec2 {
  const x = pixelX / map.tilewidth
  const y = map.height - pixelY / map.tileheight
  return [x, y]
}

function objectProps(obj: TiledObject): Record<string, number | string | boolean> | undefined {
  if (!obj.properties || obj.properties.length === 0) return undefined
  const out: Record<string, number | string | boolean> = {}
  for (const p of obj.properties) {
    const v = p.value
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[p.name] = v
  }
  return out
}

export function convertTiledMap(map: TiledMap, fallbackId: string): Level {
  const idRaw = prop(map.properties, "id")
  const themeRaw = prop(map.properties, "theme")
  const id = String(idRaw ?? fallbackId)
  const theme = String(themeRaw ?? "grass")
  const named = map.layers.find((l) => l.type === "tilelayer" && (l.name === "tiles" || l.name === "ground"))
  const tileLayer = named ?? map.layers.find((l) => l.type === "tilelayer")
  if (!tileLayer || !tileLayer.data) throw new Error("Tiled map has no tile layer data")
  const tiles = encodeTiles(tileLayer.data)
  let spawn: Vec2 | undefined
  let checkpoint: Vec2 | undefined
  const entities: LevelEntity[] = []
  for (const layer of map.layers) {
    if (layer.type !== "objectgroup" || !layer.objects) continue
    for (const obj of layer.objects) {
      const kind = objectKind(obj)
      const at = toTileYUp(map, obj.x, obj.y)
      if (kind === "spawn") spawn = at
      else if (kind === "checkpoint") checkpoint = at
      else if (kind === "walker") {
        const props = objectProps(obj) ?? {}
        if (props.dir === undefined) props.dir = -1
        entities.push({ type: "walker", at, props })
      } else if (kind === "flag") {
        const p = objectProps(obj)
        entities.push(p ? { type: "flag", at, props: p } : { type: "flag", at })
      }
    }
  }
  if (!spawn) throw new Error("Tiled map missing spawn")
  if (!checkpoint) throw new Error("Tiled map missing checkpoint")
  return { id, size: [map.width, map.height], tiles, spawn, checkpoint, entities, regions: [], theme }
}
