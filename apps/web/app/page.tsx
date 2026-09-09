import Link from "next/link";
import { ApiHealth } from "./api-health";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto min-h-svh max-w-3xl px-5 py-6 sm:px-8">
      <nav
        aria-label="Gatheroll home"
        className="flex items-center justify-between border-b border-border pb-5"
      >
        <span className="text-[17px] font-semibold tracking-tight">
          Gatheroll
        </span>
        <Link
          href="/events/new"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
        >
          Create event
        </Link>
      </nav>

      <section className="max-w-xl py-16 sm:py-24">
        <p className="mb-5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Gather + camera roll
        </p>
        <h1 className="font-display text-[clamp(2.5rem,9vw,4.25rem)] leading-[1.05] tracking-tight italic">
          A shared album that fills itself.
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
          Scan once. Take photos normally. Gatheroll helps the group bring
          every camera roll together — without the post-event chase.
        </p>
        <div className="mt-8">
          <ApiHealth />
        </div>
        <div className="mt-8">
          <Link href="/events/new" className={buttonVariants("primary", "default")}>
            Create an event →
          </Link>
        </div>
      </section>

      <section aria-labelledby="flow-heading" className="border-t border-border py-10">
        <h2
          id="flow-heading"
          className="mb-8 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
        >
          The hypothesis
        </h2>
        <ol className="grid grid-cols-1 gap-0 sm:grid-cols-4 sm:gap-6">
          {[
            "Create an event",
            "Friends scan and join",
            "Select photos and share",
            "Enjoy one shared album",
          ].map((step, i) => (
            <li
              key={step}
              className="flex gap-4 border-t border-border py-4 text-[15px] sm:flex-col sm:gap-2"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
