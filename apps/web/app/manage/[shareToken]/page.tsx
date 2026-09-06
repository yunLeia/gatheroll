"use client";

import { useParams } from "next/navigation";
import { HostPage } from "@/features/events/host-page";

export default function ManagePage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  return <HostPage key={shareToken} share={shareToken} />;
}
