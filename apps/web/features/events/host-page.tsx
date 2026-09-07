"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError, type EventInfo } from "@/lib/api";
import { inviteLink, managePath, restoreHost } from "@/lib/credentials";
import { EventHeader } from "./event-header";
import { HostParticipants } from "@/features/participants/host-participants";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
    <main className="mx-auto min-h-svh max-w-xl px-5 pt-6 pb-8 sm:px-8">
      <PageHeader />
      {error && (
        <div className="mt-6 grid gap-3">
          <p role="alert" className="text-negative">
            {error}
          </p>
          {token && (
            <Button
              variant="secondary"
              className="w-fit"
              onClick={() => setRetry((n) => n + 1)}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      {!event && !error && (
        <p role="status" className="mt-6 text-muted-foreground">
          Opening your event…
        </p>
      )}
      {event && token && (
        <>
          <p className="mt-6 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Your host space
          </p>
          <EventHeader event={event} />
          <Card className="my-7 text-center">
            <QRCodeSVG
              value={invite}
              size={256}
              level="M"
              marginSize={4}
              title="Scan to join this event"
              className="mx-auto mb-5 h-auto w-full max-w-64 rounded-md"
              bgColor="#151515"
              fgColor="#f4f3ef"
            />
            <h2 className="text-lg font-semibold tracking-tight">
              Scan to join
            </h2>
            <p className="mt-2 text-muted-foreground">
              {event.join_policy === "open"
                ? "Guests join instantly with this link."
                : "Guests request to join. You approve them below."}
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() => void copy(false)}
            >
              Copy invite link
            </Button>
            {invite.startsWith("http://localhost:") && (
              <p className="mt-3 text-sm text-faint">
                This local link only opens on this computer. For another
                phone, open Gatheroll using a reachable address first.
              </p>
            )}
          </Card>
          <HostParticipants event={event} token={token} />
          <section className="mt-9 border-t border-border pt-7">
            <h2 className="text-lg font-semibold tracking-tight">
              Keep your host access
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Save your private management link somewhere safe. It lets anyone
              holding it manage this event. Don’t send it to guests.
            </p>
            <Button
              variant="secondary"
              className="mt-4 w-fit"
              onClick={() => void copy(true)}
            >
              Copy private management link
            </Button>
          </section>
          {!persistent && (
            <p role="alert" className="mt-4 text-sm text-negative">
              This browser can’t save host access. Save your private
              management link before closing this tab.
            </p>
          )}
          {copied && (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              {copied}
            </p>
          )}
          {fallbackLink && (
            <label className="mt-4 grid gap-2 text-sm">
              Link to copy
              <input
                readOnly
                value={fallbackLink}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full min-w-0 rounded-md border border-border bg-card px-4 py-3 text-foreground"
              />
            </label>
          )}
        </>
      )}
    </main>
  );
}
