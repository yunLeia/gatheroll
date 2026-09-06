"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, type JoinPolicy } from "@/lib/api";
import { saveCredential } from "@/lib/credentials";

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
    if (
      !title ||
      !Number.isFinite(+start) ||
      !Number.isFinite(+end) ||
      end <= start
    ) {
      setError("Enter an event name and an end time after the start time.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await api.create({
        title,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        location_name: String(form.get("location") ?? "").trim() || null,
        join_policy: String(form.get("join_policy")) as JoinPolicy,
      });
      saveCredential("host", result.event.share_token, result.manage_token);
      router.push(`/manage/${encodeURIComponent(result.event.share_token)}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 422
          ? "Check the event details and try again."
          : "We couldn’t confirm the save. Check your connection before trying again.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="event-shell">
      <Link className="back-link" href="/">
        ← Gatheroll
      </Link>
      <h1 className="event-heading">Bring everyone together.</h1>
      <p>Create a place for your event.</p>
      <form className="event-form" onSubmit={submit}>
        <label>
          Event name
          <input name="title" required maxLength={200} autoComplete="off" />
        </label>
        <label>
          Start date and time
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          End date and time
          <input name="end" type="datetime-local" required />
        </label>
        <p className="muted">Times use your device’s local time zone.</p>
        <label>
          Location (optional)
          <input name="location" maxLength={300} />
        </label>
        <fieldset className="policy-selector">
          <legend>Who can join?</legend>
          <label className="policy-option">
            <input
              type="radio"
              name="join_policy"
              value="approval_required"
              defaultChecked
            />
            <span>
              <strong>Private</strong>
              <span>Guests request to join. You approve them first.</span>
            </span>
          </label>
          <label className="policy-option">
            <input type="radio" name="join_policy" value="open" />
            <span>
              <strong>Public</strong>
              <span>Anyone with this QR or link can join instantly.</span>
            </span>
          </label>
          <p className="muted">
            Both are unlisted. Your event won’t appear in a public directory.
          </p>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="bottom-action">
          <button disabled={busy} type="submit">
            {busy ? "Creating…" : "Create event"}
          </button>
        </div>
      </form>
    </main>
  );
}
