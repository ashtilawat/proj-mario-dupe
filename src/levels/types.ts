export type Vec2 = readonly [number, number]

export interface LevelEntity {
  readonly type: string
  readonly at: Vec2
  readonly props?: Record<string, number | string | boolean>
}

export interface LevelRegion {
  readonly name: string
  readonly at: Vec2
  readonly size: Vec2
  readonly props?: Record<string, number | string | boolean>
}

export interface Level {
  readonly id: string
  readonly size: Vec2
  readonly tiles: string
  readonly spawn: Vec2
  readonly checkpoint: Vec2
  readonly entities: readonly LevelEntity[]
  readonly regions: readonly LevelRegion[]
  readonly theme: string
}
