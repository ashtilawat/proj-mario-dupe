export function encodeTiles(data: readonly number[]): string {
  if (data.length === 0) return ''
  const runs: string[] = []
  let gid = data[0]!
  let count = 1
  for (let i = 1; i < data.length; i++) {
    const next = data[i]!
    if (next === gid) {
      count += 1
    } else {
      runs.push(count + ":" + gid)
      gid = next
      count = 1
    }
  }
  runs.push(count + ":" + gid)
  return runs.join(",")
}

export function decodeTiles(rle: string, width: number, height: number): number[] {
  const expected = width * height
  if (rle === "") {
    return Array.from({ length: expected }, () => 0)
  }
  const out: number[] = []
  for (const run of rle.split(",")) {
    const sep = run.indexOf(":")
    if (sep < 0) throw new Error("Invalid RLE run: " + run)
    const count = Number(run.slice(0, sep))
    const gid = Number(run.slice(sep + 1))
    if (!Number.isInteger(count) || count < 0 || !Number.isFinite(gid)) {
      throw new Error("Invalid RLE run: " + run)
    }
    for (let i = 0; i < count; i++) out.push(gid)
  }
  if (out.length !== expected) {
    throw new Error("RLE length " + out.length + " does not match size " + width + "x" + height)
  }
  return out
}
