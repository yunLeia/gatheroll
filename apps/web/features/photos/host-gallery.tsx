import { EmptyState } from "@/components/ui/empty-state";

// Stub only: docs/product/host-photo-gallery-v1-proposal.md — no host photo
// listing/download endpoint exists yet. Do not fake photo data here; wait
// for the backend piece before wiring this up.
export function HostGallery() {
  return (
    <section className="mt-9 border-t border-border pt-7">
      <h2 className="text-lg font-semibold tracking-tight">Photos</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A gallery of everyone&rsquo;s shared photos will appear here.
      </p>
      <EmptyState
        className="mt-4"
        title="Coming soon"
        hint="Photo browsing and download for hosts isn&rsquo;t built yet."
      />
    </section>
  );
}
