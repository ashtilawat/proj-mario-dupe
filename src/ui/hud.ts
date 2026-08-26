import type { Hud, HudState, PowerState } from './types.ts'

const DEFAULT_STATE: HudState = { coins: 0, lives: 3, power: "small" }

/** The HUD's paper stock: a cream card, a darker cream edge, and ink to write with. */
const PAPER = "#f4ead2"
const PAPER_EDGE = "#e0d0a8"
const INK = "#3a2a18"

function padCoins(n: number): string {
  const v = Math.max(0, Math.floor(n))
  return v < 100 ? String(v).padStart(2, "0") : String(v)
}

function applyOverlayStyle(el: HTMLElement): void {
  el.style.position = "absolute"
  el.style.inset = "0"
  el.style.zIndex = "10"
  el.style.pointerEvents = "none"
  el.style.display = "flex"
  el.style.justifyContent = "space-between"
  el.style.alignItems = "flex-start"
  el.style.padding = "12px 16px"
  el.style.boxSizing = "border-box"
  el.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace"
  el.style.fontSize = "16px"
  el.style.fontWeight = "700"
  el.style.letterSpacing = "0.08em"
  el.style.color = "#fff"
  el.style.textShadow = "0 1px 0 #000"
}

function applyPaperStyle(el: HTMLElement): void {
  el.style.display = "flex"
  el.style.gap = "14px"
  el.style.alignItems = "baseline"
  el.style.padding = "6px 12px"
  el.style.background = PAPER
  el.style.border = "1px solid " + PAPER_EDGE
  el.style.borderRadius = "4px"
  el.style.boxShadow = "0 2px 0 rgba(58, 42, 24, 0.18)"
}

/** Ink on paper: the card lifts its items off the white-on-void overlay treatment. */
function applyInkStyle(el: HTMLElement): void {
  el.style.color = INK
  el.style.textShadow = "none"
}

function item(label: string, attr: string): { wrap: HTMLElement; value: HTMLElement } {
  const wrap = document.createElement("div")
  wrap.dataset.hudItem = attr
  wrap.style.display = "flex"
  wrap.style.gap = "6px"
  wrap.style.alignItems = "baseline"
  const lab = document.createElement("span")
  lab.dataset.hudLabel = ""
  lab.textContent = label
  lab.style.fontSize = "10px"
  lab.style.opacity = "0.8"
  const value = document.createElement("span")
  value.dataset.hudValue = attr
  wrap.append(lab, value)
  return { wrap, value }
}

export function createHud(initial: Partial<HudState> = {}): Hud {
  let state: HudState = {
    coins: initial.coins ?? DEFAULT_STATE.coins,
    lives: initial.lives ?? DEFAULT_STATE.lives,
    power: initial.power ?? DEFAULT_STATE.power,
  }

  const root = document.createElement("div")
  root.dataset.hudRoot = ""
  root.setAttribute("role", "status")
  root.setAttribute("aria-live", "polite")
  applyOverlayStyle(root)

  const coins = item("COINS", "coins")
  const lives = item("LIVES", "lives")
  const power = item("STATE", "power")

  const paper = document.createElement("div")
  paper.dataset.hudPaper = ""
  applyPaperStyle(paper)
  applyInkStyle(coins.wrap)
  applyInkStyle(lives.wrap)
  paper.append(coins.wrap, lives.wrap)
  root.append(paper, power.wrap)

  function render(): void {
    coins.value.textContent = "x " + padCoins(state.coins)
    lives.value.textContent = "x " + String(state.lives)
    power.value.textContent = state.power === "big" ? "BIG" : "SMALL"
    root.dataset.coins = String(state.coins)
    root.dataset.lives = String(state.lives)
    root.dataset.power = state.power
  }
  render()

  const hud: Hud = {
    element: root,
    mount(parent: HTMLElement) {
      const host = parent
      const pos = getComputedStyle(host).position
      if (pos === "static" || pos === "") host.style.position = "relative"
      host.appendChild(root)
    },
    unmount() { root.remove() },
    setCoins(n: number) { state = { ...state, coins: Math.max(0, Math.floor(n)) }; render() },
    setLives(n: number) { state = { ...state, lives: Math.max(0, Math.floor(n)) }; render() },
    setPower(next: PowerState) { state = { ...state, power: next }; render() },
    getState() { return state },
  }
  return hud
}
