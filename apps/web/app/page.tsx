import { ApiHealth } from "./api-health";
import Link from "next/link";

export default function Home() {
  return (
    <main>
      <nav aria-label="Gatheroll home">
        <span className="wordmark">Gatheroll</span>
        <Link href="/events/new">Create event</Link>
      </nav>

      <section className="hero">
        <p className="eyebrow">Gather + camera roll</p>
        <h1>A shared album that fills itself.</h1>
        <p className="lede">
          Scan once. Take photos normally. Gatheroll helps the group bring every
          camera roll together—without the post-event chase.
        </p>
        <ApiHealth />
        <p>
          <Link className="primary-link" href="/events/new">
            Create an event →
          </Link>
        </p>
      </section>

      <section className="flow" aria-labelledby="flow-heading">
        <h2 id="flow-heading">The hypothesis</h2>
        <ol>
          <li>
            <span>01</span>Create an event
          </li>
          <li>
            <span>02</span>Friends scan and join
          </li>
          <li>
            <span>03</span>Select broadly, review privately
          </li>
          <li>
            <span>04</span>Enjoy one shared album
          </li>
        </ol>
      </section>
    </main>
  );
}
