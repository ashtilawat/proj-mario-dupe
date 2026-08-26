import type { Tuning } from './types.ts'
import {
  PRD_TUNING_DEFAULTS,
  TUNING_KEYS,
  TUNING_LABELS,
  cloneTuning,
  mergeTuning,
} from './types.ts'
import type { TuningKey } from './types.ts'

export type ClipboardLike = {
  writeText(text: string): Promise<void>
}

export type TuningPanelOptions = {
  tuning?: Partial<Tuning>
  onChange?: (tuning: Tuning) => void
  clipboard?: ClipboardLike
}

export type TuningPanel = {
  getTuning(): Tuning
  setTuning(next: Partial<Tuning>): void
  copySource(): Promise<string>
  dispose(): void
}

const CONSTANT_NAMES: Record<TuningKey, string> = {
  gravity: 'GRAVITY',
  jumpVelocity: 'JUMP_VELOCITY',
  jumpCutoffFactor: 'JUMP_CUTOFF_FACTOR',
  walkMax: 'WALK_MAX',
  dashMax: 'DASH_MAX',
  groundAccel: 'GROUND_ACCEL',
  groundFriction: 'GROUND_FRICTION',
  airAccel: 'AIR_ACCEL',
  airDrag: 'AIR_DRAG',
  terminalVelocity: 'TERMINAL_VELOCITY',
  stompBounce: 'STOMP_BOUNCE',
  wallSlideMaxFall: 'WALL_SLIDE_MAX_FALL',
  coyoteTimeMs: 'COYOTE_TIME_MS',
  jumpBufferMs: 'JUMP_BUFFER_MS',
  tileSize: 'TILE_SIZE',
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  const asFixed = value.toString()
  return asFixed
}

export function formatTuningAsSource(tuning: Tuning): string {
  const constLines = TUNING_KEYS.map(
    (key) => `export const ${CONSTANT_NAMES[key]} = ${formatNumber(tuning[key])}`,
  )
  const objectLines = TUNING_KEYS.map(
    (key) => `  ${key}: ${formatNumber(tuning[key])},`,
  )
  return [
    ...constLines,
    '',
    'export const PRD_TUNING = {',
    ...objectLines,
    '}',
    '',
  ].join('\n')
}

function resolveClipboard(override?: ClipboardLike): ClipboardLike | undefined {
  if (override) return override
  const nav = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (nav && typeof nav.writeText === 'function') return nav
  return undefined
}

function syncInputs(root: HTMLElement, tuning: Tuning): void {
  for (const key of TUNING_KEYS) {
    const input = root.querySelector(`input[name="${key}"]`)
    if (input instanceof HTMLInputElement) {
      input.value = String(tuning[key])
    }
  }
}

export function mountTuningPanel(
  container: HTMLElement,
  opts: TuningPanelOptions = {},
): TuningPanel {
  let tuning = mergeTuning(PRD_TUNING_DEFAULTS, opts.tuning)
  const onChange = opts.onChange
  const clipboard = resolveClipboard(opts.clipboard)

  const root = document.createElement('div')
  root.className = 'debug-tuning-panel'
  root.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  root.style.fontSize = '12px'
  root.style.display = 'grid'
  root.style.gap = '4px'

  const title = document.createElement('div')
  title.textContent = 'PRD 4.2 tuning'
  title.style.fontWeight = '700'
  root.appendChild(title)

  for (const key of TUNING_KEYS) {
    const label = document.createElement('label')
    label.style.display = 'flex'
    label.style.justifyContent = 'space-between'
    label.style.gap = '8px'
    label.style.alignItems = 'center'

    const caption = document.createElement('span')
    caption.textContent = TUNING_LABELS[key]
    label.appendChild(caption)

    const input = document.createElement('input')
    input.type = 'number'
    input.step = 'any'
    input.name = key
    input.value = String(tuning[key])
    input.style.width = '8em'
    input.addEventListener('input', () => {
      const parsed = Number(input.value)
      if (!Number.isFinite(parsed)) return
      tuning = { ...tuning, [key]: parsed }
      onChange?.(cloneTuning(tuning))
    })
    label.appendChild(input)
    root.appendChild(label)
  }

  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.textContent = 'Copy'
  copyButton.addEventListener('click', () => {
    void copySource()
  })
  root.appendChild(copyButton)

  container.appendChild(root)

  function getTuning(): Tuning {
    return cloneTuning(tuning)
  }

  function setTuning(next: Partial<Tuning>): void {
    tuning = mergeTuning(tuning, next)
    syncInputs(root, tuning)
    onChange?.(cloneTuning(tuning))
  }

  async function copySource(): Promise<string> {
    const source = formatTuningAsSource(tuning)
    if (clipboard) await clipboard.writeText(source)
    return source
  }

  function dispose(): void {
    root.remove()
  }

  return { getTuning, setTuning, copySource, dispose }
}
