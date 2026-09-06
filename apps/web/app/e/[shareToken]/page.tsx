"use client";

import { useParams } from "next/navigation";
import { PublicEventPage } from "@/features/events/public-event-page";

export default function EventPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  return <PublicEventPage key={shareToken} share={shareToken} />;
}
