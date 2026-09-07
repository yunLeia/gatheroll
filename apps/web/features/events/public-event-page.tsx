"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type EventInfo } from "@/lib/api";
import { EventHeader } from "./event-header";
import { JoinPanel } from "@/features/participants/join-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

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
    <main className="mx-auto min-h-svh max-w-xl px-5 pt-6 pb-8 sm:px-8">
      <PageHeader />
      {error && (
        <div className="mt-6 grid gap-3">
          <p role="alert" className="text-negative">
            {error}
          </p>
          <Button
            variant="secondary"
            onClick={() => setRetry((n) => n + 1)}
            className="w-fit"
          >
            Try again
          </Button>
        </div>
      )}
      {!event && !error && (
        <p role="status" className="mt-6 text-muted-foreground">
          Loading your event…
        </p>
      )}
      {event && (
        <>
          <EventHeader event={event} />
          <JoinPanel event={event} />
        </>
      )}
    </main>
  );
}
