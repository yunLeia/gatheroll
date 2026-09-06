import type { EventInfo } from "@/lib/api";

export function EventHeader({ event }: { event: EventInfo }) {
  return (
    <header className="event-header">
      <p className="eyebrow">
        {event.join_policy === "open" ? "Public event" : "Private event"} ·
        Unlisted
      </p>
      <h1 className="event-heading">{event.title}</h1>
      <p>
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
      {event.location_name && <p className="location">{event.location_name}</p>}
      <p className="muted">Times shown in your device’s time zone.</p>
    </header>
  );
}
