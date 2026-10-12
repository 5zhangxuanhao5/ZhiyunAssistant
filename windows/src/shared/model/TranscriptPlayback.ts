import { Transcript } from './Timeline';
export function spokenLineIndex(lines: Transcript[], at: number, pageStart: number = -1): number {
  if (!Number.isFinite(at) || at < 0) return -1;
  let low = 0, high = lines.length - 1, index = -1;
  while (low <= high) { const middle = Math.floor((low + high) / 2); if (lines[middle].t <= at) { index = middle; low = middle + 1; } else high = middle - 1; }
  if (index < 0) return lines.length && pageStart >= 0 && at >= pageStart ? 0 : -1;
  const line = lines[index], next = lines[index + 1]?.t;
  const end = line.end > line.t ? Math.min(line.end, next ?? line.end) : next ?? line.t + 8;
  return at < end ? index : -1;
}

// Merged transcription has no page boundary to reset the playback color. Retain
// the most recently spoken sentence through pauses and while playback is paused.
export function currentSpokenLineIndex(lines: Transcript[], at: number): number {
  if (!Number.isFinite(at) || at < 0) return -1;
  let low = 0, high = lines.length - 1, result = -1;
  while (low <= high) { const middle = Math.floor((low + high) / 2); if (lines[middle].t <= at) { result = middle; low = middle + 1; } else high = middle - 1; }
  return result;
}
