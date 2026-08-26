/**
 * Parse a URL hash of the form `#level=1-1`. Missing or unrelated hashes
 * return null. Warp itself is a stub — applyLevelHash only invokes an
 * optional callback until T-008 lands.
 */
export function parseLevelHash(hash: string): string | null {
  if (!hash) return null
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash
  if (!trimmed) return null
  const params = new URLSearchParams(trimmed)
  const level = params.get('level')
  if (!level) return null
  return level
}

export function applyLevelHash(
  hash: string,
  onWarp?: (levelId: string) => void,
): string | null {
  const id = parseLevelHash(hash)
  if (id && onWarp) onWarp(id)
  return id
}
