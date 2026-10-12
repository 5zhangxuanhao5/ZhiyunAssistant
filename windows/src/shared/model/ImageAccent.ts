function luminance(red: number, green: number, blue: number): number { const linear = (value: number): number => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); return 0.2126 * linear(red / 255) + 0.7152 * linear(green / 255) + 0.0722 * linear(blue / 255); }
export function imageAccent(pixels: Uint8Array, width: number, height: number, stride: number): string {
  const candidates = ['#7C3AED', '#007E87', '#D7265E', '#22D3EE', '#A3E635'];
  const edge: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { if (x > 1 && x < width - 2 && y > 1 && y < height - 2) continue; const at = y * stride + x * 4; if (at + 3 < pixels.length && pixels[at + 3] > 127) edge.push(luminance(pixels[at], pixels[at + 1], pixels[at + 2])); }
  if (!edge.length) return candidates[0];
  let best = candidates[0], score = -1;
  candidates.forEach((color: string) => { const light = luminance(parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)); const contrasts = edge.map((value: number) => (Math.max(value, light) + 0.05) / (Math.min(value, light) + 0.05)).sort((a: number, b: number) => a - b); const quality = contrasts[Math.floor(contrasts.length * 0.2)] * 0.7 + contrasts.reduce((sum: number, value: number) => sum + value, 0) / contrasts.length * 0.3; if (quality > score) { best = color; score = quality; } });
  return best;
}
