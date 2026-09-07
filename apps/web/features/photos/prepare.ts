import { capturedAt, contentType } from "./selection";
import type { PhotoJob, PhotoMetadata } from "./types";

export const THUMBNAIL_LONG_SIDE = 384;
const MAX_DECODE_PIXELS = 40_000_000;

function clientId(): string {
  // getRandomValues also works on same-Wi-Fi HTTP; randomUUID requires secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function metadata(file: File): Promise<PhotoMetadata> {
  const result: PhotoMetadata = {
    captured_at: null,
    latitude: null,
    longitude: null,
    width: null,
    height: null,
  };
  try {
    const { default: exifr } = await import("exifr");
    const values = (await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "OffsetTimeOriginal",
        "GPSLatitude",
        "GPSLatitudeRef",
        "GPSLongitude",
        "GPSLongitudeRef",
        "ExifImageWidth",
        "ExifImageHeight",
      ],
      reviveValues: false,
    })) as Record<string, unknown> | undefined;
    if (!values) return result;
    result.captured_at = capturedAt(
      values.DateTimeOriginal,
      values.OffsetTimeOriginal,
    );
    const number = (v: unknown, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
        ? v
        : null;
    result.latitude = number(values.latitude, -90, 90);
    result.longitude = number(values.longitude, -180, 180);
    result.width = number(values.ExifImageWidth, 1, 100000);
    result.height = number(values.ExifImageHeight, 1, 100000);
  } catch {
    /* Missing/unsupported EXIF must not reject the original. */
  }
  return result;
}

async function thumbnail(
  file: File,
  meta: PhotoMetadata,
  maxBytes: number,
): Promise<Blob | null> {
  if (meta.width && meta.height && meta.width * meta.height > MAX_DECODE_PIXELS)
    return null;
  const source = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = source;
    await img.decode();
    if (img.naturalWidth * img.naturalHeight > MAX_DECODE_PIXELS) return null;
    meta.width = img.naturalWidth;
    meta.height = img.naturalHeight;
    const scale = Math.min(
      1,
      THUMBNAIL_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.75),
    );
    canvas.width = canvas.height = 0;
    return blob && blob.size <= maxBytes ? blob : null;
  } catch {
    return null; // HEIC decoding varies by browser. The original remains uploadable.
  } finally {
    img.src = "";
    URL.revokeObjectURL(source);
  }
}

export async function preparePhoto(
  file: File,
  maxThumbnailBytes: number,
): Promise<PhotoJob> {
  const meta = await metadata(file);
  const thumb = await thumbnail(file, meta, maxThumbnailBytes);
  return {
    input: {
      ...meta,
      client_id: clientId(),
      original_filename: file.name,
      content_type: contentType(file),
      file_size_bytes: file.size,
      thumbnail_size_bytes: thumb?.size ?? null,
    },
    file,
    thumbnail: thumb,
    preview: thumb ? URL.createObjectURL(thumb) : null,
    state: "selected",
    originalUploaded: false,
    thumbnailUploaded: false,
  };
}
