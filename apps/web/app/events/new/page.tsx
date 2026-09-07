"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, type JoinPolicy } from "@/lib/api";
import { saveCredential } from "@/lib/credentials";
import { PageHeader } from "@/components/ui/page-header";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

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
    <main className="mx-auto min-h-svh max-w-xl px-5 pt-6 pb-8 sm:px-8">
      <PageHeader />
      <h1 className="mt-4 font-display text-4xl italic tracking-tight sm:text-5xl">
        Bring everyone together.
      </h1>
      <p className="mt-3 text-muted-foreground">Create a place for your event.</p>
      <form className="mt-8 grid gap-6" onSubmit={submit}>
        <Field label="Event name" name="title" required maxLength={200} autoComplete="off" />
        <Field
          label="Start date and time"
          name="start"
          type="datetime-local"
          required
        />
        <Field
          label="End date and time"
          name="end"
          type="datetime-local"
          required
          hint="Times use your device’s local time zone."
        />
        <Field label="Location (optional)" name="location" maxLength={300} />
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Who can join?</legend>
          {(
            [
              {
                value: "approval_required",
                title: "Private",
                desc: "Guests request to join. You approve them first.",
                defaultChecked: true,
              },
              {
                value: "open",
                title: "Public",
                desc: "Anyone with this QR or link can join instantly.",
                defaultChecked: false,
              },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3.5 rounded-md border border-border p-4",
                "has-checked:border-foreground/60 has-checked:bg-card",
              )}
            >
              <input
                type="radio"
                name="join_policy"
                value={option.value}
                defaultChecked={option.defaultChecked}
                className="mt-1 h-[18px] w-[18px] flex-none accent-foreground"
              />
              <span className="grid gap-1">
                <strong className="font-medium">{option.title}</strong>
                <span className="text-sm text-muted-foreground">
                  {option.desc}
                </span>
              </span>
            </label>
          ))}
          <p className="text-sm text-muted-foreground">
            Both are unlisted. Your event won’t appear in a public directory.
          </p>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 bg-background pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          <Button size="lg" disabled={busy} type="submit">
            {busy ? "Creating…" : "Create event"}
          </Button>
        </div>
      </form>
    </main>
  );
}
