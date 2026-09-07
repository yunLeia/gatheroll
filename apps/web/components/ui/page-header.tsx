import Link from "next/link";

export function PageHeader({
  backHref = "/",
  backLabel = "Gatheroll",
}: {
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-6 flex items-center">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← {backLabel}
      </Link>
    </div>
  );
}
