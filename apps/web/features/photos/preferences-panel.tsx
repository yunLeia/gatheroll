"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ParticipantPreferences } from "@/lib/api";

function PreferenceRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex min-h-11 w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-7 w-12 flex-none rounded-full border border-border transition-colors",
          checked ? "bg-primary" : "bg-transparent",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-foreground transition-transform",
            checked && "translate-x-[20px] bg-primary-foreground",
          )}
        />
      </span>
    </button>
  );
}

export function PreferencesPanel({
  initial,
  busy,
  onContinue,
}: {
  initial: ParticipantPreferences;
  busy: boolean;
  onContinue: (prefs: ParticipantPreferences) => void;
}) {
  const [includeSelfies, setIncludeSelfies] = useState(initial.include_selfies);
  const [includeScreenshots, setIncludeScreenshots] = useState(
    initial.include_screenshots,
  );
  return (
    <section
      className="space-y-5 rounded-lg border border-border bg-card p-5"
      aria-label="Upload preferences"
    >
      <div>
        <h3 className="font-semibold">What should we include?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Save your preferences for how Gatheroll should organize this event.
        </p>
      </div>
      <PreferenceRow
        title="Selfies"
        description="Saved for later — everything you pick still uploads today"
        checked={includeSelfies}
        onToggle={() => setIncludeSelfies((v) => !v)}
      />
      <PreferenceRow
        title="Screenshots"
        description="Saved for later — everything you pick still uploads today"
        checked={includeScreenshots}
        onToggle={() => setIncludeScreenshots((v) => !v)}
      />
      <Button
        size="lg"
        disabled={busy}
        onClick={() =>
          onContinue({
            include_selfies: includeSelfies,
            include_screenshots: includeScreenshots,
          })
        }
      >
        {busy ? "Saving…" : "Continue"}
      </Button>
    </section>
  );
}
