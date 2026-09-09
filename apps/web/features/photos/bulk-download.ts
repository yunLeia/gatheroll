import { DOWNLOAD_CONCURRENCY } from "./bulk-download-core";
import type { AlbumApi } from "./album-api";
import type { StoredPhoto } from "./types";

export { DOWNLOAD_CONCURRENCY, collectAll } from "./bulk-download-core";

async function fetchAsFile(
  url: string,
  filename: string,
  contentType: string,
  signal: AbortSignal,
): Promise<File> {
  const response = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) throw new Error("Original download failed");
  const blob = await response.blob();
  return new File([blob], filename, { type: contentType });
}

async function fetchAll(
  photos: StoredPhoto[],
  service: Pick<AlbumApi, "original">,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<File[]> {
  const files = new Array<File>(photos.length);
  let index = 0;
  let done = 0;
  async function worker() {
    while (!signal.aborted && index < photos.length) {
      const i = index++;
      const photo = photos[i];
      const { url } = await service.original(photo.id, signal, true);
      files[i] = await fetchAsFile(
        url,
        photo.original_filename,
        photo.content_type,
        signal,
      );
      onProgress(++done, photos.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, photos.length) }, worker),
  );
  return files;
}

// One download at a time, each a real navigation to the signed original URL
// (the exact mechanism the single-photo "Download original" button already
// uses reliably) -- not a blob. A prior version zipped everything client-side
// with a blob: URL, but real testing showed Chrome gets permanently stuck
// showing "Unconfirmed ####.crdownload" for programmatically-triggered blob
// zip downloads (a Safe Browsing deep-scan issue, not something fixable from
// JS). Spaced out so the browser's "site is downloading multiple files"
// permission prompt (shown once, after the second auto-triggered download)
// has a moment to register each click as distinct.
async function downloadSequentially(
  photos: StoredPhoto[],
  service: Pick<AlbumApi, "original">,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < photos.length; i++) {
    if (signal.aborted) return;
    const { url } = await service.original(photos[i].id, signal, true);
    const link = document.createElement("a");
    link.href = url;
    link.download = photos[i].original_filename;
    document.body.append(link);
    link.click();
    link.remove();
    onProgress(i + 1, photos.length);
    if (i < photos.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
}

export type BulkDownloadResult = { mode: "share" | "sequential" | "empty" };

// Prefers the OS share sheet (native "Save Images to Photos/Gallery" on
// mobile) over separate downloads: one tap saves everything, versus N
// separate files landing in Downloads. Web Share requires a secure context
// (HTTPS or localhost) and file-sharing support; unavailable there (as on
// today's plain-HTTP LAN dev setup), this falls back to triggering each
// photo's real download individually.
export async function bulkDownload(
  photos: StoredPhoto[],
  service: Pick<AlbumApi, "list" | "original">,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<BulkDownloadResult> {
  if (!photos.length) return { mode: "empty" };
  const share = (navigator as Navigator & { share?: (data: { files: File[] }) => Promise<void> })
    .share;
  if (typeof share !== "function") {
    await downloadSequentially(photos, service, signal, onProgress);
    return signal.aborted ? { mode: "empty" } : { mode: "sequential" };
  }
  const files = await fetchAll(photos, service, signal, onProgress);
  if (signal.aborted) return { mode: "empty" };
  const canShare = (
    navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
  ).canShare;
  if (canShare?.({ files })) {
    await share({ files });
    return { mode: "share" };
  }
  await downloadSequentially(photos, service, signal, onProgress);
  return signal.aborted ? { mode: "empty" } : { mode: "sequential" };
}
