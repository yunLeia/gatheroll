"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type EventInfo, type Participant } from "@/lib/api";
import {
  forgetCredential,
  readCredential,
  saveCredential,
} from "@/lib/credentials";
import { usePolling } from "@/lib/use-polling";

export function JoinPanel({ event }: { event: EventInfo }) {
  const share = event.share_token;
  const [restored, setRestored] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    // Restore browser-only credentials after hydration; never read them on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(readCredential("participant", share));
    setRestored(true);
  }, [share]);

  const poll = useCallback(
    async (signal: AbortSignal) => {
      if (!token) return false;
      try {
        const result = await api.me(share, token, signal);
        if (signal.aborted) return true;
        setParticipant(result);
        setError("");
        return result.status === "pending";
      } catch (cause) {
        if (signal.aborted) return true;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          setInvalid(true);
          setError("This browser’s saved access is no longer valid.");
          return false;
        }
        setError(
          "We couldn’t check your request. We’ll retry while this page is open.",
        );
        return true;
      }
    },
    [share, token],
  );
  usePolling(
    restored &&
      !!token &&
      !invalid &&
      (!participant || participant.status === "pending"),
    poll,
  );

  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) {
      setError("Please enter your name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.join(share, name);
      setPersistent(
        saveCredential("participant", share, result.participant_token),
      );
      setToken(result.participant_token);
      setParticipant(result.participant);
    } catch {
      setError(
        "We couldn’t confirm your join request. Check your connection before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="join-panel" aria-live="polite">
      {!restored && <p>Checking this browser…</p>}
      {restored && !token && (
        <>
          <h2>
            {event.join_policy === "open"
              ? "Come on in."
              : "Join this gathering."}
          </h2>
          <p>
            {event.join_policy === "open"
              ? "Anyone with this QR or link can join instantly."
              : "Send a request. Your host will let you in."}
          </p>
          <form onSubmit={join} className="event-form">
            <label>
              Your name
              <input
                name="name"
                autoComplete="given-name"
                maxLength={80}
                required
              />
            </label>
            <div className="bottom-action">
              <button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Join Gatheroll"}
              </button>
            </div>
          </form>
          <p className="muted">Just your name. No account needed.</p>
        </>
      )}
      {token && !participant && !invalid && <p>Checking your request…</p>}
      {participant && !invalid && (
        <>
          <h2>
            {participant.status === "pending"
              ? "Request sent"
              : participant.status === "approved"
                ? "You’re in."
                : "Your request wasn’t approved."}
          </h2>
          <p>
            {participant.status === "pending"
              ? "Waiting for the host to let you in…"
              : participant.status === "approved"
                ? "Photos will appear here when sharing is available."
                : "You can check with the person who invited you."}
          </p>
        </>
      )}
      {!persistent && (
        <p role="status">
          This browser can’t save your access. Keep this tab open; refreshing
          may lose your request.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {invalid && (
        <button
          className="secondary"
          onClick={() => {
            forgetCredential("participant", share);
            setToken(null);
            setParticipant(null);
            setInvalid(false);
            setError("");
          }}
        >
          Clear saved access
        </button>
      )}
    </section>
  );
}
