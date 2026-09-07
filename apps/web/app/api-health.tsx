"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type ApiStatus = "checking" | "available" | "unavailable";

export function ApiHealth() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const apiBaseUrl =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

    fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }
        setStatus("available");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setStatus("unavailable");
      });

    return () => controller.abort();
  }, []);

  const message = {
    checking: "Checking API…",
    available: "API connected",
    unavailable: "API unavailable — start the backend on port 8000",
  }[status];

  const dotColor = {
    checking: "bg-muted-foreground",
    available: "bg-positive",
    unavailable: "bg-negative",
  }[status];

  return (
    <p
      className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card/60 px-3.5 py-2 text-[13px] text-muted-foreground"
      aria-live="polite"
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dotColor)} />
      {message}
    </p>
  );
}
