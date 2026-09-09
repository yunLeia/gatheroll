# ADR 007: Trust participant selection as event relevance; move AI to cleanup, organization, and download

> **Product correction (2026-09-08, ADR 008):** uploading selected photos is the
> sharing action for the event; no separate post-upload sharing confirmation is
> required. Earlier private-staging/confirmation language below is superseded.
> The shared album now serves the host and every approved participant (ADR 009).
> See [ADR 008](../adr/008-upload-is-event-sharing.md).

Status: Accepted — 2026-09-08. Supersedes the event-relevance-as-primary-AI-target
framing in [ADR 005](005-event-boundaries-are-not-membership.md) and the visual/
context relevance hypothesis in
[docs/product/event-relevance.md](../product/event-relevance.md).

## Context

ADR 005 already established that host-defined time/GPS boundaries are not event
membership. The remaining open question was whether *visual* signals (embedding
similarity to other selected candidates) should determine event relevance
instead. An experiment toward that (SigLIP 2 embedding similarity: centroid /
nearest-neighbor / top-k mean baselines, with a hard boundary against ever
reading human labels during scoring) was designed and implemented on a
separate branch (`relevance-embeddings`, not merged — see the branch
disposition below).

Before labeling real data for that experiment, we reconsidered the premise.
Participants already perform an intentional, effortful act when they bulk-
select "everything from around the event" out of their camera roll — that
selection already **is** their statement of event intent. Re-deriving
"does this belong" visually would be solving a problem the product's own
input step has arguably already solved, at real engineering cost (a new
runtime dependency class, a labeling burden, a genuinely hard eval problem
per the experiment design's own multi-scene/cold-start caveats) for
uncertain product benefit.

## Decision

**Event relevance for V1: trust the participant's bulk selection. Do not
build relevance-determining AI for V1.** No embedding similarity, no
metadata scoring, no clustering, decides what "belongs" to the event —
the participant's selection does.

Gatheroll's AI/vision investment moves to three areas that act *after*
relevance is already settled by the user, where AI removes clearer,
narrower, more verifiable pieces of manual work:

1. **Pre-upload cleanup** — detect (not auto-remove) selfies, screenshots,
   and possibly-blurry/low-quality photos among the participant's own
   selection, before upload. AI suggests, the participant decides
   include/exclude. Exact/near-duplicate detection is a later addition to
   this same step.
2. **Shared-album organization** — multi-label smart filters (`People`,
   `Selfies`, `Food`, `Scenery`, `Candid`) over the shared collection.
   Filters, not folders: one photo can carry multiple labels without being
   duplicated in storage.
3. **Download** — "Download all" excludes photos the current participant
   already uploaded themselves (and later, exact/near-duplicates they
   already own), so downloading only returns what they're actually missing.

Product story: **everyone contributes once; Gatheroll cleans and organizes
the shared collection and lets each person download only what they're
missing.**

## Branch disposition: `relevance-embeddings`

Inspected rather than merged. It contains two things worth separating:

**Reusable infrastructure (keep, likely to be reused by cleanup work):**
- `eval/embeddings/generate.py` — a local, isolated SigLIP 2 embedding
  generator with content-hash-based incremental caching and
  model/embedding-version provenance recorded in its output artifact. The
  caching/versioning design is generic to "generate and reuse local vision
  embeddings," not specific to relevance scoring.
- The eval harness extension pattern itself: `participant_id` on the
  dataset schema, and the precedent of a structurally different (event-
  grouped rather than per-example) evaluation path living alongside the
  existing one in `reporting.ts`/`cli.ts` without disturbing it. Screenshot/
  selfie/blur detection will need their own dataset shape (per-photo binary
  labels, not per-event relevance labels) and their own evaluation path,
  but the *pattern* of adding a second path without touching the first is
  directly reusable.

**Relevance-specific, not reusable as-is (do not carry forward):**
- `apps/web/evaluation/embeddings.ts`'s three scoring baselines
  (`siglip_centroid`, `siglip_nearest_neighbor`, `siglip_topk_mean`) — these
  compute *event membership* by comparing a candidate to other candidates in
  the same event. Selfie/screenshot/blur detection are per-photo properties
  with no such cross-candidate, same-event comparison; nothing about
  centroid/nearest-neighbor/top-k-mean similarity transfers to them.
- The self-exclusion / cross-participant-support bookkeeping — meaningful
  only for a same-event comparison problem.
- `docs/eval/002-relevance-embedding-experiment-design.md`'s labeling
  scheme (`belongs`/`does_not_belong`/`ambiguous` per photo-event pair) —
  cleanup detectors need a different, simpler per-photo label shape
  (e.g. `is_selfie: bool`, `is_screenshot: bool`).

**Recommendation:** keep the branch unmerged, as experimental history —
do not delete it. If/when the cleanup work needs local vision embeddings
for something embedding-similarity-shaped (an early, cheap pass at
near-duplicate grouping is the most plausible future fit — see "later:
exact/near duplicates" in the product story above), cherry-pick or
reimplement `generate.py`'s caching design rather than reviving the
relevance scoring code around it.

## Alternatives considered

- **Finish the relevance-embeddings experiment first, decide after seeing
  real numbers.** Rejected for V1: even a positive result would only prove
  visual similarity correlates with event membership on ~30-50 photos across
  2-3 events — not enough to justify shipping it over trusting selection,
  given the added architecture (a new ML runtime dependency, an ongoing
  labeling burden, multi-scene/cold-start failure modes the experiment's own
  design doc already flags as real risks) for a signal the product already
  has for free from the user's own action.
- **Keep relevance AI as a future V2 idea but say nothing now.** Rejected —
  silently abandoning documented direction without a record would make the
  existing relevance docs actively misleading to a future reader (including
  an interviewer reading this repository), and the codebase's own convention
  is to record decisions as they're made, not retroactively.

## Consequences

- Hosts and participants get the exact same flow they already have; nothing
  about event creation, joining, or photo intake changes.
- The next engineering slice is Pre-upload Cleanup v1 (screenshot, selfie,
  blur detection) — proposed as its own technical plan, not decided by this
  ADR.
- Prior relevance work (time/GPS metadata experiment, this embedding
  experiment) remains in the repository as measured, dated history, not
  deleted or rewritten — see
  [docs/learning/006-vision-ai-direction-pivot.md](../learning/006-vision-ai-direction-pivot.md)
  for the fuller narrative and interview-ready framing.
- "Trust participant selection" is a product bet, not a proof: a
  participant's broad selection can still include private/unrelated photos
  mixed in by habit (e.g. camera-roll browsing muscle memory) — that risk is
  exactly what pre-upload cleanup review and the existing
  uploaded-private-≠-shared boundary ([ADR 004](004-private-photo-intake-lifecycle.md))
  continue to guard against, just without an AI relevance gate in front of it.
