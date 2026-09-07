"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError, type EventInfo, type Participant } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

export function HostParticipants({
  event,
  token,
}: {
  event: EventInfo;
  token: string;
}) {
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Ignore a list response started before an approval/rejection completed.
  const mutation = useRef(0);
  const poll = useCallback(
    async (signal: AbortSignal) => {
      const version = mutation.current;
      try {
        const result = await api.participants(event.share_token, token, signal);
        if (!signal.aborted && version === mutation.current) {
          setPeople(result);
          setError("");
        }
        return true;
      } catch (cause) {
        if (signal.aborted) return true;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          setDenied(true);
          setPeople(null);
          setError("Your management access is no longer valid.");
          return false;
        }
        setError("We couldn’t refresh the list. We’ll try again shortly.");
        return true;
      }
    },
    [event.share_token, token],
  );
  usePolling(!denied, poll);

  async function decide(person: Participant, status: "approved" | "rejected") {
    if (busy) return;
    setBusy(person.id);
    setError("");
    mutation.current++;
    try {
      const result = await api.decide(
        event.share_token,
        person.id,
        token,
        status,
      );
      mutation.current++;
      setPeople(
        (current) =>
          current?.map((p) => (p.id === result.id ? result : p)) ?? null,
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "This request already has a decision. The list will refresh shortly."
          : "We couldn’t confirm the decision. It’s safe to retry the same action.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-9">
      <h2 className="text-lg font-semibold tracking-tight">
        Participants {people ? `(${people.length})` : ""}
      </h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
      {!people && !error && (
        <p role="status" className="mt-3 text-muted-foreground">
          Loading participants…
        </p>
      )}
      {people?.length === 0 && (
        <EmptyState
          className="mt-4"
          title="No one yet."
          hint={
            event.join_policy === "open"
              ? "Share the QR to bring people in."
              : "Requests will appear here to approve."
          }
        />
      )}
      <ul className="mt-4 grid gap-3">
        {people?.map((person) => (
          <li key={person.id}>
            <Card className="min-w-0">
              <h3 className="font-medium">{person.display_name}</h3>
              <div className="mt-2">
                <StatusBadge
                  status={
                    person.status === "approved" ? "approved" : person.status
                  }
                >
                  {person.status === "pending"
                    ? "Waiting for approval"
                    : person.status === "approved"
                      ? event.join_policy === "open"
                        ? "Joined"
                        : "Approved"
                      : "Not approved"}
                </StatusBadge>
              </div>
              {person.status === "pending" && (
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    className="flex-1"
                    disabled={!!busy || denied}
                    onClick={() => void decide(person, "approved")}
                  >
                    Approve
                    <span className="sr-only"> {person.display_name}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={!!busy || denied}
                    onClick={() => void decide(person, "rejected")}
                  >
                    Reject
                    <span className="sr-only"> {person.display_name}</span>
                  </Button>
                </div>
              )}
              {busy === person.id && (
                <p role="status" className="mt-3 text-sm text-muted-foreground">
                  Saving decision…
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
