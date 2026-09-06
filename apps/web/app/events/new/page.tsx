"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function CreateEventPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const start = new Date(String(form.get("start")));
    const end = new Date(String(form.get("end")));
    if (!title || !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) {
      setError("Enter an event name and an end time after the start time.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`${apiBase}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, starts_at: start.toISOString(), ends_at: end.toISOString(),
          location_name: String(form.get("location") ?? "").trim() || null,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        setError(response.status === 422
          ? "Check the event details and try again."
          : "We couldn’t save the event. Please try again shortly.");
        setBusy(false);
        return;
      }
      const result: { share_token: string } = await response.json();
      router.push(`/e/${encodeURIComponent(result.share_token)}`);
    } catch {
      setError("We couldn’t confirm the save. Check your connection before trying again.");
      setBusy(false);
    }
  }

  return <main className="event-shell">
    <Link href="/">← Gatheroll</Link>
    <h1 className="event-heading">Bring everyone together.</h1>
    <p>Create a place for your event.</p>
    <form className="event-form" onSubmit={submit}>
      <label>Event name<input name="title" required maxLength={200} autoComplete="off" /></label>
      <label>Start date and time<input name="start" type="datetime-local" required /></label>
      <label>End date and time<input name="end" type="datetime-local" required /></label>
      <p className="muted">Times use your device’s local time zone.</p>
      <label>Location (optional)<input name="location" maxLength={300} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} type="submit">{busy ? "Creating…" : "Create event"}</button>
    </form>
  </main>;
}
