// M0 stub — shared entity type declarations. Types only, no runtime code.

/** Stable identifier for an entity. */
export type EntityId = number

/** Marker for anything that participates in the world. Fields land in later milestones. */
export interface Entity {
  readonly id: EntityId
}
