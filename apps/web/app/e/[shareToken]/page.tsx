"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type PublicEvent = {
  title: string; starts_at: string; ends_at: string; location_name: string | null;
};
type State =
  | { kind: "loading" }
  | { kind: "ready"; event: PublicEvent }
  | { kind: "missing" | "error" };

export default function EventPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    fetch(`${apiBase}/events/${encodeURIComponent(shareToken)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      cache: "no-store",
    }).then(async response => {
      if (response.status === 404) return setState({ kind: "missing" });
      if (!response.ok) throw new Error("Event fetch failed");
      const event: PublicEvent = await response.json();
      if (!controller.signal.aborted) setState({ kind: "ready", event });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: "error" });
    });
    return () => controller.abort();
  }, [shareToken, attempt]);

  return <main className="event-shell">
    <Link href="/">← Gatheroll</Link>
    {state.kind === "loading" && <p role="status">Loading your event…</p>}
    {state.kind === "missing" && <><h1 className="event-heading">Event not found.</h1><p>Check the link with your host.</p></>}
    {state.kind === "error" && <><p role="alert">We couldn’t load this event. Please try again.</p><button onClick={() => { setState({ kind: "loading" }); setAttempt(n => n + 1); }}>Try again</button></>}
    {state.kind === "ready" && <>
      <h1 className="event-heading">{state.event.title}</h1>
      <p>{new Date(state.event.starts_at).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}<br />
        – {new Date(state.event.ends_at).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</p>
      <p className="muted">Times shown in your device’s local time zone.</p>
      {state.event.location_name && <p>{state.event.location_name}</p>}
      <section className="photo-placeholder">Photos will appear here.</section>
    </>}
  </main>;
}
