"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, type EventInfo } from "@/lib/api";
import { EventHeader } from "./event-header";
import { JoinPanel } from "@/features/participants/join-panel";

export function PublicEventPage({ share }: { share: string }) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .event(share, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setEvent(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof ApiError && cause.status === 404
              ? "Event not found. Check the link with your host."
              : "We couldn’t load this event. Please try again.",
          );
      });
    return () => controller.abort();
  }, [share, retry]);
  return (
    <main className="event-shell">
      <Link className="back-link" href="/">
        ← Gatheroll
      </Link>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </>
      )}
      {!event && !error && <p role="status">Loading your event…</p>}
      {event && (
        <>
          <EventHeader event={event} />
          <JoinPanel event={event} />
        </>
      )}
    </main>
  );
}
