import type { EventInfo } from "@/lib/api";

export function EventHeader({ event }: { event: EventInfo }) {
  return (
    <header className="my-7">
      <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {event.join_policy === "open" ? "Public event" : "Private event"} ·
        Unlisted
      </p>
      <h1 className="font-display text-4xl italic tracking-tight sm:text-5xl">
        {event.title}
      </h1>
      <p className="mt-4 text-muted-foreground">
        {new Date(event.starts_at).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        <br />–{" "}
        {new Date(event.ends_at).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
      {event.location_name && (
        <p className="mt-1 text-muted-foreground">{event.location_name}</p>
      )}
      <p className="mt-3 text-sm text-faint">
        Times shown in your device’s time zone.
      </p>
    </header>
  );
}
