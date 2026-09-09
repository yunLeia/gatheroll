"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AlbumApi } from "./album-api";
import type { StoredPhoto } from "./types";

export function OriginalViewer({ photo, service, onClose }: {
  photo: StoredPhoto;
  service: AlbumApi;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const controller = new AbortController();
    element?.showModal();
    service.original(photo.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) setUrl(result.url);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      downloadRequest.current?.abort();
      element?.close();
    };
  }, [photo.id, service]);

  async function download() {
    if (downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloading(true);
    setError("");
    try {
      // Reauthorize and sign afresh: the preview link may have expired.
      const result = await service.original(photo.id, controller.signal, true);
      if (controller.signal.aborted) return;
      const link = document.createElement("a");
      link.href = result.url;
      link.referrerPolicy = "no-referrer";
      link.download = photo.original_filename;
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      if (!controller.signal.aborted)
        setError("Couldn’t prepare the download. Please try again.");
    } finally {
      downloadRequest.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  return (
    <dialog ref={dialog} onCancel={onClose} aria-label="Photo viewer"
      className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%-2rem)] max-w-4xl overflow-auto rounded-lg border border-border bg-background p-4 text-foreground backdrop:bg-black/80">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm">{photo.original_filename}</p>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {failed ? (
        <p role="status" className="py-12 text-center text-muted-foreground">
          This original can’t be displayed here. Download it to view on your device,
          or close and reopen to retry.
        </p>
      ) : url ? (
        // Signed originals go directly to storage, never through Next image optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={photo.original_filename} referrerPolicy="no-referrer"
          onError={() => setFailed(true)} className="max-h-[65svh] w-full object-contain" />
      ) : <p role="status" className="py-12 text-center">Loading original…</p>}
      <Button className="mt-4 w-full" disabled={downloading} onClick={() => void download()}>
        {downloading ? "Preparing download…" : "Download original"}
      </Button>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
    </dialog>
  );
}
