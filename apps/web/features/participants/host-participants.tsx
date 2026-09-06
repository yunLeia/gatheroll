"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError, type EventInfo, type Participant } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";

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
    <section className="participant-section">
      <h2>Participants {people ? `(${people.length})` : ""}</h2>
      {error && <p role="alert">{error}</p>}
      {!people && !error && <p role="status">Loading participants…</p>}
      {people?.length === 0 && (
        <p className="empty-state">
          {event.join_policy === "open"
            ? "No one has joined yet."
            : "No one has requested to join yet."}
        </p>
      )}
      <ul className="participant-list">
        {people?.map((person) => (
          <li className="participant-card" key={person.id}>
            <h3>{person.display_name}</h3>
            <p className="muted">
              {person.status === "pending"
                ? "Waiting for approval"
                : person.status === "approved"
                  ? event.join_policy === "open"
                    ? "Joined"
                    : "Approved"
                  : "Not approved"}
            </p>
            {person.status === "pending" && (
              <div className="card-actions">
                <button
                  disabled={!!busy || denied}
                  onClick={() => void decide(person, "approved")}
                >
                  Approve<span className="sr-only"> {person.display_name}</span>
                </button>
                <button
                  className="secondary"
                  disabled={!!busy || denied}
                  onClick={() => void decide(person, "rejected")}
                >
                  Reject<span className="sr-only"> {person.display_name}</span>
                </button>
              </div>
            )}
            {busy === person.id && <p role="status">Saving decision…</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
