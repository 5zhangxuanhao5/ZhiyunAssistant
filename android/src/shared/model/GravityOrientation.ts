// Ignore flat/diagonal poses so rotation does not chatter around a boundary.
export function gravityOrientation(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  if (Math.abs(x) >= 7 && Math.abs(y) <= 6) return 'landscape';
  if (Math.abs(y) >= 7 && Math.abs(x) <= 6) return 'portrait';
  return '';
}
