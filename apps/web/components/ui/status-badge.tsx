import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeStatus = "pending" | "approved" | "rejected";

const styles: Record<BadgeStatus, string> = {
  pending: "border-caution/30 bg-caution/15 text-caution",
  approved: "border-positive/30 bg-positive/15 text-positive",
  rejected: "border-negative/30 bg-negative/15 text-negative",
};

export function StatusBadge({
  status,
  children,
}: {
  status: BadgeStatus;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        styles[status],
      )}
    >
      {children}
    </span>
  );
}
