// The level exit, as something you can see. The hitbox behind it is read by `createFlags`
// in main.ts and is deliberately not owned here — this module is art.
export type { FlagSpawn } from './flag.ts'
export {
  BANNER_COLOR,
  BANNER_DROP,
  BANNER_HEIGHT,
  BANNER_WIDTH,
  FLAG_HEIGHT,
  FLAG_WIDTH,
  Flag,
  POLE_COLOR,
  POLE_DEPTH,
  POLE_HEIGHT,
  POLE_WIDTH,
  createFlag,
} from './flag.ts'
