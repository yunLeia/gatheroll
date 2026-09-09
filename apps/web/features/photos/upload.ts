import type {
  Authorization,
  PhotoInput,
  PhotoJob,
  UploadTarget,
} from "./types";

export const UPLOAD_CONCURRENCY = 3;
const PUT_TIMEOUT_MS = 120_000;

// Duck-types rather than importing ApiError from @/lib/api, so this file
// (and its standalone-transpiled tests) stay dependency-free. A present
// numeric `status` means the server responded and rejected the request
// itself (client payload problem, most likely) -- storage/connection are
// not the right things to blame for a 4xx. No status at all means the
// request never got a response (offline, timeout, DNS, CORS).
function initializeErrorMessage(cause: unknown): string {
  const status =
    cause && typeof cause === "object" && "status" in cause
      ? (cause as { status: unknown }).status
      : undefined;
  if (typeof status === "number" && status >= 500)
    return "The server couldn't prepare this upload. Try again in a moment.";
  if (typeof status === "number")
    return "This upload couldn't be prepared. Refresh the page, reselect your photos, and retry.";
  return "Couldn't reach the server to start this upload. Check your connection, then retry.";
}

export async function putObject(
  target: UploadTarget,
  body: Blob,
  signal: AbortSignal,
): Promise<void> {
  // No application Authorization header and no Next/FastAPI proxy.
  const response = await fetch(target.url, {
    method: "PUT",
    body,
    headers: target.headers,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(PUT_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error("Storage upload failed");
}

type Services = {
  initialize: (
    photos: PhotoInput[],
    signal: AbortSignal,
  ) => Promise<Authorization[]>;
  complete: (id: string, signal: AbortSignal) => Promise<unknown>;
  put: typeof putObject;
};

export async function uploadBatch(
  jobs: PhotoJob[],
  services: Services,
  signal: AbortSignal,
  update: (job: PhotoJob) => void,
): Promise<void> {
  const pending = jobs.filter((job) => job.state !== "uploaded");
  if (!pending.length || signal.aborted) return;
  let targets: Authorization[];
  try {
    targets = await services.initialize(
      pending.map((job) => job.input),
      signal,
    );
  } catch (cause) {
    if (!signal.aborted)
      pending.forEach((job) =>
        update({
          ...job,
          state: "failed",
          error: initializeErrorMessage(cause),
        }),
      );
    return;
  }
  const byClientId = new Map(
    targets.map((target) => [target.client_id, target]),
  );
  let index = 0;
  async function worker() {
    while (!signal.aborted && index < pending.length) {
      let job = { ...pending[index++] };
      const target = byClientId.get(job.input.client_id);
      try {
        if (!target) throw new Error("Missing upload authorization");
        job = { ...job, state: "uploading", error: undefined };
        update(job);
        if (target.status !== "uploaded_private") {
          if (!job.originalUploaded) {
            if (!target.original) throw new Error("Missing original target");
            await services.put(target.original, job.file, signal);
            job = { ...job, originalUploaded: true };
            update(job);
          }
          if (job.thumbnail && !job.thumbnailUploaded) {
            if (!target.thumbnail) throw new Error("Missing thumbnail target");
            await services.put(target.thumbnail, job.thumbnail, signal);
            job = { ...job, thumbnailUploaded: true };
            update(job);
          }
          try {
            await services.complete(target.id, signal);
          } catch (cause) {
            // HEAD found missing/mismatched storage: retry must resend bytes.
            // For a lost response/503, keep checkpoints and retry only confirmation.
            if (
              cause &&
              typeof cause === "object" &&
              "status" in cause &&
              cause.status === 409
            ) {
              job = {
                ...job,
                originalUploaded: false,
                thumbnailUploaded: false,
              };
            }
            throw cause;
          }
        }
        if (!signal.aborted) update({ ...job, state: "uploaded" });
      } catch {
        if (!signal.aborted)
          update({
            ...job,
            state: "failed",
            error: "Not confirmed. Retry keeps successful upload steps.",
          });
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, pending.length) },
      worker,
    ),
  );
}
