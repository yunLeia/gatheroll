"use client";

import { useEffect } from "react";

export const POLL_INTERVAL_MS = 5000;

// onPoll returns false after a terminal state or authorization failure.
// Schedule after completion, rather than setInterval, to avoid overlapping requests.
export function usePolling(
  enabled: boolean,
  onPoll: (signal: AbortSignal) => Promise<boolean>,
) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const visible = () => document.visibilityState !== "hidden";
    async function run() {
      if (stopped || inFlight || !visible()) return;
      inFlight = true;
      controller = new AbortController();
      try {
        if (!(await onPoll(controller.signal))) stopped = true;
      } finally {
        inFlight = false;
        if (!stopped && visible()) timer = setTimeout(run, POLL_INTERVAL_MS);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") controller?.abort();
      else void run();
    }
    void run();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, onPoll]);
}
