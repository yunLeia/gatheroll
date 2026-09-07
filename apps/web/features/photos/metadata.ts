import { capturedAt } from "./selection";
import type { PhotoMetadata } from "./types";

export function normalizeMetadata(values?: Record<string, unknown>): PhotoMetadata {
  const number = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
  return {
    captured_at: capturedAt(values?.DateTimeOriginal, values?.OffsetTimeOriginal),
    latitude: number(values?.latitude, -90, 90),
    longitude: number(values?.longitude, -180, 180),
    width: number(values?.ExifImageWidth, 1, 100000),
    height: number(values?.ExifImageHeight, 1, 100000),
  };
}

// Both browser intake and offline evaluation call this exact parser/options path.
// Never substitute file mtime, browser timezone, GPS time or export modification time.
export async function extractMetadata(input: File | Uint8Array): Promise<PhotoMetadata> {
  try {
    const { default: exifr } = await import("exifr");
    const values = await exifr.parse(input, {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal", "GPSLatitude", "GPSLatitudeRef",
        "GPSLongitude", "GPSLongitudeRef", "ExifImageWidth", "ExifImageHeight"],
      reviveValues: false,
    }) as Record<string, unknown> | undefined;
    return normalizeMetadata(values);
  } catch {
    return normalizeMetadata(); // Missing/unsupported/corrupt EXIF is unavailable evidence.
  }
}
