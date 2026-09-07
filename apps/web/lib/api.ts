export type JoinPolicy = "open" | "approval_required";
export type ParticipantStatus = "pending" | "approved" | "rejected";
export type EventInfo = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  share_token: string;
  join_policy: JoinPolicy;
};
export type Participant = {
  id: string;
  display_name: string;
  status: ParticipantStatus;
  joined_at: string;
  approved_at: string | null;
};
export type CreateInput = {
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  join_policy: JoinPolicy;
};

export class ApiError extends Error {
  constructor(public status: number) {
    super("The request could not be completed.");
  }
}

export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
    cache: "no-store",
    referrerPolicy: "no-referrer",
  }).catch((cause: unknown) => {
    // Diagnostic category only: never log URLs, credentials, headers or response bodies.
    if (process.env.NODE_ENV === "development" && !options.signal?.aborted) {
      console.warn(
        "Gatheroll API connection failed",
        cause instanceof Error ? cause.name : "unknown",
      );
    }
    throw cause;
  });
  if (!response.ok) {
    if (process.env.NODE_ENV === "development")
      console.warn("Gatheroll API status", response.status);
    throw new ApiError(response.status);
  }
  return response.json() as Promise<T>;
}

const eventPath = (share: string) => `/events/${encodeURIComponent(share)}`;
export const api = {
  create: (body: CreateInput) =>
    request<{ event: EventInfo; manage_token: string }>("/events", {
      method: "POST",
      body,
    }),
  event: (share: string, signal: AbortSignal) =>
    request<EventInfo>(eventPath(share), { signal }),
  managed: (share: string, token: string, signal: AbortSignal) =>
    request<EventInfo>(`${eventPath(share)}/manage`, { token, signal }),
  join: (share: string, name: string) =>
    request<{ participant: Participant; participant_token: string }>(
      `${eventPath(share)}/participants`,
      { method: "POST", body: { display_name: name } },
    ),
  me: (share: string, token: string, signal: AbortSignal) =>
    request<Participant>(`${eventPath(share)}/participants/me`, {
      token,
      signal,
    }),
  participants: (share: string, token: string, signal: AbortSignal) =>
    request<Participant[]>(`${eventPath(share)}/participants`, {
      token,
      signal,
    }),
  decide: (
    share: string,
    id: string,
    token: string,
    status: "approved" | "rejected",
  ) =>
    request<Participant>(
      `${eventPath(share)}/participants/${encodeURIComponent(id)}`,
      { method: "PATCH", token, body: { status } },
    ),
};
