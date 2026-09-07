"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { photoApi } from "./api";
import { DiagnosticPanel } from "./diagnostic-panel";
import { recordDiagnostic, tracePhotoStep } from "./diagnostics";
import { preparePhoto } from "./prepare";
import { selectionError } from "./selection";
import { putObject, uploadBatch, UPLOAD_CONCURRENCY } from "./upload";
import type { PhotoJob, PhotoLimits, StoredPhoto } from "./types";

function Preview({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return (
      <div className="flex aspect-square items-center justify-center bg-card p-2 text-center text-xs text-muted-foreground">
        Original selected
        <br />
        Preview unavailable
      </div>
    );
  // Native img is deliberate: never route private signed URLs through Next image optimization.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="aspect-square w-full object-cover"
    />
  );
}

export function IntakePanel({
  share,
  token,
}: {
  share: string;
  token: string;
}) {
  const service = useMemo(() => photoApi(share, token), [share, token]);
  const picker = useRef<HTMLInputElement>(null);
  const jobsRef = useRef<PhotoJob[]>([]);
  const urls = useRef(new Set<string>());
  const alive = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const [jobs, setJobs] = useState<PhotoJob[]>([]);
  const [limits, setLimits] = useState<PhotoLimits | null>(null);
  const [stored, setStored] = useState<StoredPhoto[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [preparing, setPreparing] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [measurement, setMeasurement] = useState("");
  const [reload, setReload] = useState(0);

  function replaceJobs(next: PhotoJob[]) {
    jobsRef.current = next;
    if (alive.current) setJobs(next);
  }

  useEffect(() => {
    alive.current = true;
    const objectUrls = urls.current;
    return () => {
      alive.current = false;
      operation.current?.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    service
      .limits(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLimits(result);
        return service.list(controller.signal);
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        setStored(page.photos);
        recordDiagnostic("list_loaded", { count: page.photos.length });
        setNextOffset(page.next_offset);
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted) recordDiagnostic("list_failed");
        if (!controller.signal.aborted)
          setError(
            "Photo storage is unavailable. Check your connection or ask the organizer to configure storage.",
          );
      });
    // Signed previews expire. Reauthorize on return, without polling in the background.
    const visible = () => {
      recordDiagnostic("visibility", { hidden: document.hidden });
      if (!document.hidden) setReload((n) => n + 1);
    };
    const pagehide = (event: PageTransitionEvent) =>
      recordDiagnostic("pagehide", { persisted: event.persisted });
    const pageshow = (event: PageTransitionEvent) =>
      recordDiagnostic("pageshow", { persisted: event.persisted });
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [service, reload]);

  function release(job: PhotoJob) {
    if (job.preview) {
      URL.revokeObjectURL(job.preview);
      urls.current.delete(job.preview);
    }
  }

  async function selectPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // The same file can be selected again after removal.
    if (!limits || locked.current || !files.length) return;
    recordDiagnostic("selection", {
      count: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
    });
    const retained = jobsRef.current.filter((job) => job.state !== "uploaded");
    if (retained.length + files.length > limits.batch_limit) {
      setError(
        `Choose up to ${limits.batch_limit - retained.length} more photos. No new photos were added.`,
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    jobsRef.current.filter((job) => job.state === "uploaded").forEach(release);
    replaceJobs(retained);
    const start = performance.now();
    let skipped = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (!alive.current) break;
        setPreparing(`Preparing ${index + 1} / ${files.length}`);
        if (selectionError(file, limits)) {
          skipped++;
          continue;
        }
        // One decoder at a time; yield a paint opportunity between files.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const prepareStart = performance.now();
        const job = await preparePhoto(file, limits.thumbnail_max_bytes);
        recordDiagnostic("prepare_file", {
          index: index + 1,
          bytes: file.size,
          thumbnail_bytes: job.thumbnail?.size ?? 0,
          elapsed_ms: performance.now() - prepareStart,
          preview_available: !!job.preview,
          heic: ["image/heic", "image/heif"].includes(job.input.content_type),
          type_missing: !file.type,
          captured_at_present: !!job.input.captured_at,
          gps_present:
            job.input.latitude !== null && job.input.longitude !== null,
        });
        if (!alive.current) {
          if (job.preview) URL.revokeObjectURL(job.preview);
          break;
        }
        if (job.preview) urls.current.add(job.preview);
        replaceJobs([...jobsRef.current, job]);
      }
      if (alive.current) {
        recordDiagnostic("prepare_batch", {
          count: files.length - skipped,
          skipped,
          elapsed_ms: performance.now() - start,
        });
        setNotice(
          skipped
            ? `${skipped} files skipped: unsupported format, filename, or size. Other photos are ready.`
            : "",
        );
        setMeasurement(
          `Metadata + thumbnails: ${(performance.now() - start).toFixed(0)} ms for ${files.length - skipped} files.`,
        );
      }
    } catch {
      if (alive.current)
        setError(
          "Some previews could not be prepared. Prepared photos are still available.",
        );
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(false);
        setPreparing("");
      }
    }
  }

  async function upload() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    operation.current = controller;
    const start = performance.now();
    const retryCount = jobsRef.current.filter(
      (job) => job.state === "failed",
    ).length;
    let transferredBytes = 0;
    try {
      await uploadBatch(
        jobsRef.current,
        {
          initialize: (inputs, signal) =>
            tracePhotoStep("upload_init", { count: inputs.length }, () =>
              service.initialize(inputs, signal),
            ),
          complete: (id, signal) =>
            tracePhotoStep("upload_complete", {}, () =>
              service.complete(id, signal),
            ),
          put: (target, body, signal) =>
            tracePhotoStep("object_put", { bytes: body.size }, async () => {
              await putObject(target, body, signal);
              transferredBytes += body.size;
            }),
        },
        controller.signal,
        (job) => {
          recordDiagnostic("photo_state", {
            index:
              jobsRef.current.findIndex(
                (current) => current.input.client_id === job.input.client_id,
              ) + 1,
            uploaded: job.state === "uploaded",
            failed: job.state === "failed",
            original_ready: job.originalUploaded,
            thumbnail_ready: job.thumbnailUploaded,
          });
          replaceJobs(
            jobsRef.current.map((current) =>
              current.input.client_id === job.input.client_id ? job : current,
            ),
          );
        },
      );
      if (controller.signal.aborted) return;
      recordDiagnostic("upload_batch", {
        count: jobsRef.current.length,
        retry_count: retryCount,
        uploaded: jobsRef.current.filter((job) => job.state === "uploaded")
          .length,
        failed: jobsRef.current.filter((job) => job.state === "failed").length,
        bytes: transferredBytes,
        elapsed_ms: performance.now() - start,
        concurrency: UPLOAD_CONCURRENCY,
      });
      setMeasurement(
        (previous) =>
          `${previous.split(" Upload session:")[0]} Upload session: ${((performance.now() - start) / 1000).toFixed(1)} s (includes API/confirmation).`,
      );
      const page = await service.list(controller.signal);
      if (!controller.signal.aborted) {
        setStored(page.photos);
        setNextOffset(page.next_offset);
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Could not refresh your stored photos. Upload results above are preserved. Refresh the list to check.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function loadMore() {
    if (nextOffset === null || listing) return;
    setListing(true);
    const controller = new AbortController();
    operation.current = controller;
    try {
      const page = await service.list(controller.signal, nextOffset);
      if (!controller.signal.aborted) {
        setStored((previous) => [...previous, ...page.photos]);
        setNextOffset(page.next_offset);
      }
    } catch {
      if (!controller.signal.aborted)
        setError("Could not load more photos. Try again.");
    } finally {
      if (alive.current) setListing(false);
    }
  }

  const uploaded = jobs.filter((job) => job.state === "uploaded").length;
  const failed = jobs.filter((job) => job.state === "failed").length;
  const selected = jobs.length - uploaded;
  return (
    <div className="mt-6 min-w-0 space-y-6">
      <p className="text-sm text-muted-foreground">
        Select photos from around the event. Originals and available location
        metadata are uploaded privately. Nothing is shared with your host or
        other participants.
      </p>
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Select photos"
        onChange={selectPhotos}
      />
      <Button
        size="lg"
        disabled={busy || !limits}
        onClick={() => picker.current?.click()}
      >
        Add photos
      </Button>
      {limits && (
        <p className="text-xs text-muted-foreground">
          Up to {limits.batch_limit} photos per batch ·{" "}
          {Math.round(limits.max_bytes / 1024 / 1024)} MiB each · JPEG, PNG,
          WebP, HEIC/HEIF
        </p>
      )}
      {preparing && <p role="status">{preparing}</p>}
      {notice && (
        <p role="status" className="text-sm text-caution">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-sm text-negative">
          <p>{error}</p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh list
          </Button>
        </div>
      )}
      {jobs.length > 0 && (
        <section className="space-y-3" aria-label="Selected photos">
          <p role="status">
            {uploaded > 0
              ? `${uploaded} / ${jobs.length} stored privately`
              : `${jobs.length} ${jobs.length === 1 ? "photo" : "photos"} selected`}
            {failed > 0 ? ` · ${failed} failed` : ""}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {jobs.map((job) => (
              <div
                key={job.input.client_id}
                className="min-w-0 overflow-hidden rounded-md border border-border"
              >
                <Preview url={job.preview} name={job.input.original_filename} />
                <p
                  className="truncate px-2 pt-1 text-xs"
                  title={job.input.original_filename}
                >
                  {job.input.original_filename}
                </p>
                <p className="px-2 py-1 text-xs">
                  {job.state === "uploaded" ? "Stored privately" : job.state}
                </p>
                {job.error && (
                  <p className="px-2 text-xs text-negative">{job.error}</p>
                )}
                {job.state !== "uploaded" && (
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 w-full text-xs underline disabled:opacity-50"
                    aria-label={`Remove ${job.input.original_filename}`}
                    onClick={() => {
                      release(job);
                      replaceJobs(
                        jobsRef.current.filter((item) => item !== job),
                      );
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {selected > 0 && (
            <div className="sticky bottom-0 bg-background py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <Button size="lg" disabled={busy} onClick={upload}>
                {busy
                  ? "Working…"
                  : failed === selected
                    ? `Retry ${failed}`
                    : `Upload ${selected} privately`}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Keep this page open until confirmed. Refreshing preserves completed
            uploads, but unfinished selections must be selected again.
          </p>
        </section>
      )}
      <section
        className="space-y-3 border-t border-border pt-6"
        aria-label="Your uploads"
      >
        <h3 className="font-semibold">
          Your uploads · {stored.length}
          {nextOffset !== null ? "+" : ""}
        </h3>
        <p className="text-sm text-muted-foreground">
          Stored privately · Unreviewed
        </p>
        {!stored.length && (
          <p className="text-sm text-muted-foreground">
            Confirmed uploads will appear here.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {stored.map((photo) => (
            <div
              key={photo.id}
              className="min-w-0 overflow-hidden rounded-md border border-border"
            >
              <Preview
                key={photo.preview_url}
                url={photo.preview_url}
                name={photo.original_filename}
              />
              <p
                className="truncate p-2 text-xs"
                title={photo.original_filename}
              >
                {photo.original_filename}
              </p>
            </div>
          ))}
        </div>
        {nextOffset !== null && (
          <Button
            variant="secondary"
            disabled={listing || busy}
            onClick={loadMore}
          >
            {listing ? "Loading…" : "Load more"}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy || listing}
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh previews
        </Button>
      </section>
      <DiagnosticPanel />
      {process.env.NODE_ENV === "development" && measurement && (
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11">
            Local timing (not a mobile benchmark)
          </summary>
          {measurement}
        </details>
      )}
    </div>
  );
}
