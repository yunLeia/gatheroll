"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type EventInfo, type Participant } from "@/lib/api";
import {
  forgetCredential,
  readCredential,
  saveCredential,
} from "@/lib/credentials";
import { usePolling } from "@/lib/use-polling";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { IntakePanel } from "@/features/photos/intake-panel";

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
    <section className="mt-8 border-t border-border pt-7" aria-live="polite">
      {!restored && (
        <p className="text-muted-foreground">Checking this browser…</p>
      )}
      {restored && !token && (
        <>
          <h2 className="text-xl font-semibold tracking-tight">
            {event.join_policy === "open"
              ? "Come on in."
              : "Join this gathering."}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {event.join_policy === "open"
              ? "Anyone with this QR or link can join instantly."
              : "Send a request. Your host will let you in."}
          </p>
          <form onSubmit={join} className="mt-6 grid gap-6">
            <Field
              label="Your name"
              name="name"
              autoComplete="given-name"
              maxLength={80}
              required
            />
            <div className="sticky bottom-0 bg-background pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
              <Button size="lg" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Join Gatheroll"}
              </Button>
            </div>
          </form>
          <p className="mt-3 text-sm text-faint">
            Just your name. No account needed.
          </p>
        </>
      )}
      {token && !participant && !invalid && (
        <p className="text-muted-foreground">Checking your request…</p>
      )}
      {participant && !invalid && (
        <>
          <h2 className="text-xl font-semibold tracking-tight">
            {participant.status === "pending"
              ? "Request sent"
              : participant.status === "approved"
                ? "You’re in."
                : "Your request wasn’t approved."}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {participant.status === "pending"
              ? "Waiting for the host to let you in…"
              : participant.status === "approved"
                ? "You can now add your photos privately."
                : "You can check with the person who invited you."}
          </p>
        </>
      )}
      {participant && participant.status === "approved" && token && !invalid && (
        <IntakePanel
          key={share}
          share={share}
          token={token}
          participant={participant}
          onPreferencesUpdated={setParticipant}
        />
      )}
      {!persistent && (
        <p role="status" className="mt-4 text-sm text-caution">
          This browser can’t save your access. Keep this tab open; refreshing
          may lose your request.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error}
        </p>
      )}
      {invalid && (
        <Button
          variant="secondary"
          className="mt-4 w-fit"
          onClick={() => {
            forgetCredential("participant", share);
            setToken(null);
            setParticipant(null);
            setInvalid(false);
            setError("");
          }}
        >
          Clear saved access
        </Button>
      )}
    </section>
  );
}
