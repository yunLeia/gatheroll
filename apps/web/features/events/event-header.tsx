import type { EventInfo } from "@/lib/api";
import { eventDateLabel } from "./date";

export function EventHeader({ event }: { event: EventInfo }) {
  const date = eventDateLabel(event.event_date);
  return (
    <header className="my-7">
      <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {event.join_policy === "open" ? "Public event" : "Private event"} ·
        Unlisted
      </p>
      <h1 className="font-display text-4xl italic tracking-tight sm:text-5xl">
        {event.title}
      </h1>
      {date && <p className="mt-4 text-muted-foreground">{date}</p>}
      {event.location_name && (
        <p className="mt-1 text-muted-foreground">{event.location_name}</p>
      )}
    </header>
  );
}
