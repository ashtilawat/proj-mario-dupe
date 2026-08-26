export type PowerState = 'small' | 'big'

export interface HudState {
  readonly coins: number
  readonly lives: number
  readonly power: PowerState
}

export interface Hud {
  readonly element: HTMLElement
  mount(parent: HTMLElement): void
  unmount(): void
  setCoins(coins: number): void
  setLives(lives: number): void
  setPower(power: PowerState): void
  getState(): HudState
}
