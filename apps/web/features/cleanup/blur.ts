export type PixelBuffer = {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3 | 4; // RGB or RGBA; alpha (if present) is ignored
};

// Laplacian-variance sharpness score: grayscale, apply a 4-neighbor
// discrete Laplacian, return the variance of the response. Higher = sharper.
// No model, no training -- a standard, decades-old CV technique.
export function computeBlurScore(pixels: PixelBuffer): number {
  const { data, width, height, channels } = pixels;
  if (width < 3 || height < 3) return 0; // no interior pixels for a 3x3 kernel
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  let sum = 0,
    sumSq = 0,
    count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        gray[idx - width] +
        gray[idx + width] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export type CleanupConfig = { version: string; blur_threshold: number };

export function possiblyBlurry(blurScore: number, config: CleanupConfig): boolean {
  return blurScore < config.blur_threshold;
}
