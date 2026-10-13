export interface FrameSignature { samples: number[]; contrast: number }
export function frameSignature(bytes: Uint8Array, width: number, height: number, stride: number): FrameSignature {
  const samples: number[] = [];
  if (width < 16 || height < 9 || bytes.length < stride * height) return { samples, contrast: 0 };
  for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) { const offset = Math.min(height - 1, Math.floor((y + 0.5) * height / 9)) * stride + Math.min(width - 1, Math.floor((x + 0.5) * width / 16)) * 4; samples.push((bytes[offset] + bytes[offset + 1] + bytes[offset + 2]) / 3); }
  const mean = samples.reduce((sum: number, value: number) => sum + value, 0) / samples.length;
  return { samples, contrast: Math.sqrt(samples.reduce((sum: number, value: number) => sum + (value - mean) ** 2, 0) / samples.length) };
}
export function sameFrames(left: FrameSignature[], right: FrameSignature[]): boolean {
  if (left.length < 2 || left.length !== right.length) return false;
  return left.every((frame: FrameSignature, index: number) => { const other = right[index]; if (frame.contrast < 12 || other.contrast < 12 || frame.samples.length !== other.samples.length) return false; return frame.samples.reduce((sum: number, value: number, i: number) => sum + Math.abs(value - other.samples[i]), 0) / frame.samples.length < 6; });
}
