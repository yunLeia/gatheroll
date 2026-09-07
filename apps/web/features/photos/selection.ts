import type { PhotoLimits } from "./types";

// Some system pickers leave HEIC MIME blank. Do not override a supplied MIME.
export function contentType(file: { type: string; name: string }): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    (
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heif",
      } as Record<string, string>
    )[extension ?? ""] ?? ""
  );
}

export function selectionError(
  file: { type: string; name: string; size: number },
  limits: PhotoLimits,
): string | null {
  if (!limits.accepted_types.includes(contentType(file)))
    return "Unsupported image format";
  if (file.size === 0 || file.size > limits.max_bytes)
    return "File is empty or too large";
  if (!file.name.trim() || file.name.length > 255)
    return "Filename is too long or empty";
  return null;
}

export function capturedAt(date: unknown, offset: unknown): string | null {
  // Camera wall time without an explicit offset is NOT a trustworthy UTC instant.
  if (
    typeof date !== "string" ||
    typeof offset !== "string" ||
    !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ||
    !/^[+-]\d{2}:\d{2}$/.test(offset)
  )
    return null;
  const wallTime = `${date.slice(0, 10).replaceAll(":", "-")}T${date.slice(11)}`;
  const calendarCheck = Date.parse(`${wallTime}Z`);
  if (
    !Number.isFinite(calendarCheck) ||
    new Date(calendarCheck).toISOString().slice(0, 19) !== wallTime
  )
    return null; // Do not silently normalize corrupt EXIF such as February 30.
  const value = `${wallTime}${offset}`;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
