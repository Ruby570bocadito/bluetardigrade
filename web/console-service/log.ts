// Minimal readable logging for the hub: one ISO time prefix per line,
// no emojis, no box art. Kept in its own module so the entry point and
// the hub share the exact same format.

function stamp(): string {
  return new Date().toISOString().slice(11, 19)
}

export function logLine(line: string): void {
  console.log(`[${stamp()}] ${line}`)
}

export function logError(line: string): void {
  console.error(`[${stamp()}] ${line}`)
}
