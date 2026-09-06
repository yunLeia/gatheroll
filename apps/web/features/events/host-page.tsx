"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError, type EventInfo } from "@/lib/api";
import { inviteLink, managePath, restoreHost } from "@/lib/credentials";
import { EventHeader } from "./event-header";
import { HostParticipants } from "@/features/participants/host-participants";

export function HostPage({ share }: { share: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState("");
  const [fallbackLink, setFallbackLink] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const hadFragment = !!window.location.hash;
    const restored = restoreHost(share);
    // Keep Next's internal URL in sync too, so it cannot restore the fragment later.
    if (hadFragment)
      router.replace(`/manage/${encodeURIComponent(share)}`, { scroll: false });
    // Browser storage and URL fragments are unavailable during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(restored.token);
    setPersistent(restored.persisted);
    setInvite(inviteLink(window.location.origin, share));
    if (!restored.token) {
      setError("Open your private management link to manage this event.");
      return;
    }
    api
      .managed(share, restored.token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setEvent(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof ApiError && [401, 403].includes(cause.status)
            ? "This management link is not valid for this event."
            : cause instanceof ApiError && cause.status === 404
              ? "Event not found."
              : "We couldn’t load your event. Please try again.",
        );
      });
    return () => controller.abort();
  }, [share, retry, router]);

  async function copy(privateLink: boolean) {
    if (!token) return;
    const value = privateLink
      ? `${window.location.origin}${managePath(share, token)}`
      : invite;
    try {
      await navigator.clipboard.writeText(value);
      setFallbackLink("");
      setCopied(
        privateLink
          ? "Private management link copied. Keep it to yourself."
          : "Invite link copied.",
      );
    } catch {
      setCopied("Copy isn’t available here. Select and copy the link below.");
      setFallbackLink(value);
    }
  }

  return (
    <main className="event-shell">
      <Link className="back-link" href="/">
        ← Gatheroll
      </Link>
      {error && (
        <>
          <p role="alert">{error}</p>
          {token && (
            <button
              className="secondary"
              onClick={() => setRetry((n) => n + 1)}
            >
              Try again
            </button>
          )}
        </>
      )}
      {!event && !error && <p role="status">Opening your event…</p>}
      {event && token && (
        <>
          <p className="host-label">Your host space</p>
          <EventHeader event={event} />
          <section className="invite-card">
            <QRCodeSVG
              value={invite}
              size={256}
              level="M"
              marginSize={4}
              title="Scan to join this event"
            />
            <h2>Scan to join</h2>
            <p>
              {event.join_policy === "open"
                ? "Guests join instantly with this link."
                : "Guests request to join. You approve them below."}
            </p>
            <button onClick={() => void copy(false)}>Copy invite link</button>
            {invite.startsWith("http://localhost:") && (
              <p className="muted">
                This local link only opens on this computer. For another phone,
                open Gatheroll using a reachable address first.
              </p>
            )}
          </section>
          <HostParticipants event={event} token={token} />
          <section className="host-recovery">
            <h2>Keep your host access</h2>
            <p className="muted">
              Save your private management link somewhere safe. It lets anyone
              holding it manage this event. Don’t send it to guests.
            </p>
            <button className="secondary" onClick={() => void copy(true)}>
              Copy private management link
            </button>
          </section>
          {!persistent && (
            <p role="alert">
              This browser can’t save host access. Save your private management
              link before closing this tab.
            </p>
          )}
          {copied && <p role="status">{copied}</p>}
          {fallbackLink && (
            <label className="copy-fallback">
              Link to copy
              <input
                readOnly
                value={fallbackLink}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          )}
        </>
      )}
    </main>
  );
}
