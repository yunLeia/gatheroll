"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { albumApi } from "./album-api";
import { bulkDownload, collectAll } from "./bulk-download";
import { OriginalViewer } from "./original-viewer";
import type { StoredPhoto } from "./types";

function AlbumThumbnail({ photo }: { photo: StoredPhoto }) {
  const [failed, setFailed] = useState(false);
  if (!photo.preview_url || failed)
    return <span className="flex aspect-square items-center justify-center bg-card p-2 text-xs text-muted-foreground">Open photo<br />Preview unavailable</span>;
  return (
    // Thumbnails load directly from signed storage URLs.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo.preview_url} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={() => setFailed(true)} className="aspect-square w-full object-cover" />
  );
}

export function SharedAlbum({ share, token }: {
  share: string;
  token: string;
}) {
  const service = useMemo(() => albumApi(share, token), [share, token]);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [query, setQuery] = useState({ offset: 0, refresh: 0 });
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<StoredPhoto | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const downloadRequest = useRef<AbortController | null>(null);

  useEffect(() => () => downloadRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    // Synchronize UI with an external authenticated request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    setError("");
    service.list(controller.signal, query.offset).then((page) => {
      if (controller.signal.aborted) return;
      setPhotos((previous) => query.offset === 0 ? page.photos :
        [...new Map([...previous, ...page.photos].map((photo) => [photo.id, photo])).values()]);
      setNextOffset(page.next_offset);
      setLoaded(true);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      const denied = cause instanceof ApiError && [401, 403, 404].includes(cause.status);
      if (denied) {
        setPhotos([]);
        setNextOffset(null);
        setSelected(null);
        setLoaded(false);
      }
      setError(denied ? "This album requires host access or approved participation in this event."
        : "Couldn’t load the album. Refresh to try again.");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [service, query]);

  async function downloadAll() {
    if (downloading) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloading(true);
    setDownloadError("");
    setProgress(null);
    try {
      const others = await collectAll(service, controller.signal, true);
      const result = await bulkDownload(
        others,
        service,
        controller.signal,
        (done, total) => setProgress({ done, total }),
      );
      if (result.mode === "empty" && !controller.signal.aborted)
        setDownloadError("Nothing to download -- every photo here is one you uploaded.");
    } catch {
      if (!controller.signal.aborted)
        setDownloadError("Couldn’t prepare the download. Please try again.");
    } finally {
      downloadRequest.current = null;
      if (!controller.signal.aborted) {
        setDownloading(false);
        setProgress(null);
      }
    }
  }

  return (
    <section className="mt-9 min-w-0 border-t border-border pt-7" aria-label="Shared album">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Shared album</h2>
        <Button variant="secondary" disabled={busy} onClick={() => {
          setBusy(true);
          setQuery((current) => ({ offset: 0, refresh: current.refresh + 1 }));
        }}>Refresh</Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Photos from everyone in this event. The host and approved participants can view and download them.</p>
      {loaded && <p className="mt-3 text-sm text-faint">{photos.length} photos loaded{nextOffset !== null ? " · More available" : ""}</p>}
      {loaded && photos.length > 0 && (
        <>
          <Button variant="secondary" className="mt-4 w-full" disabled={downloading}
            onClick={() => void downloadAll()}>
            {downloading
              ? progress
                ? `Downloading ${progress.done}/${progress.total}…`
                : "Preparing…"
              : "Download all (excluding mine)"}
          </Button>
          <p className="mt-2 text-xs text-faint">
            On some browsers this downloads each photo separately -- allow
            multiple downloads if prompted.
          </p>
        </>
      )}
      {downloadError && <p role="alert" className="mt-3 text-sm text-negative">{downloadError}</p>}
      {busy && <p role="status" className="mt-4 text-muted-foreground">Loading photos…</p>}
      {error && <p role="alert" className="mt-4 text-negative">{error}</p>}
      {loaded && !photos.length && !busy && !error && <p className="mt-6 text-muted-foreground">No photos yet. Upload photos to start the album.</p>}
      <div className="mt-4 grid grid-cols-3 gap-1 sm:grid-cols-4">
        {photos.map((photo) => <button key={photo.id} type="button"
          aria-label={`Open ${photo.original_filename}`}
          className="min-h-11 min-w-0 overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => setSelected(photo)}>
          <AlbumThumbnail key={photo.preview_url} photo={photo} />
        </button>)}
      </div>
      {nextOffset !== null && <Button variant="secondary" className="mt-4 w-full" disabled={busy}
        onClick={() => {
          setBusy(true);
          setQuery((current) => ({ offset: nextOffset, refresh: current.refresh + 1 }));
        }}>Load more</Button>}
      {selected && <OriginalViewer key={selected.id} photo={selected} service={service} onClose={() => setSelected(null)} />}
    </section>
  );
}
