# Gatheroll relevance model — 2026-09-07 (superseded 2026-09-08)

> **Product correction (2026-09-08, ADR 008):** uploading selected photos is the
> sharing action for the event; no separate post-upload sharing confirmation is
> required. Earlier private-staging/confirmation language below is superseded.
> The shared album now serves the host and every approved participant (ADR 009).
> See [ADR 008](../adr/008-upload-is-event-sharing.md).

## Superseded — 2026-09-08

**Event relevance is no longer an AI target for V1.** [ADR 007](../adr/007-cleanup-first-ai-direction.md)
decided to trust the participant's bulk selection as the relevance signal
directly, rather than building visual/context AI to re-derive it. The
"Future hypothesis" section below (visual embeddings → similarity →
relevance recommendation) was partially implemented as an experiment on the
unmerged `relevance-embeddings` branch before this correction — see
[docs/learning/006-vision-ai-direction-pivot.md](../learning/006-vision-ai-direction-pivot.md)
for why. Everything below is preserved as the **2026-09-07 product-model
snapshot**, not current direction. The host-boundary correction it documents
(participants' selection over exact host time windows) remains current; only
the "visual/contextual relevance is the future AI hypothesis" framing is
superseded.

# Gatheroll relevance model — 2026-09-07 (historical)

Gatheroll does not require hosts to define precise event boundaries. Participants
already perform the first broad selection from their own camera rolls. Event relevance
is therefore primarily a visual/context problem, not a timestamp filtering problem.
Capture timestamps are supporting metadata, not ground truth.

Host creates a gathering with a name, optional date/location, and join policy. Participant
intentionally selects a candidate batch. The question is: **Is this selected photo
actually part of the shared gathering?** Earlier/later can belong. Same time/place can
be unrelated. Same location != same event; different/no GPS != unrelated.

## Future hypothesis, not implemented architecture

Participant-selected candidate batch → visual embeddings/image semantics → within-batch
similarity → cross-user visual corroboration → optional weak metadata context → relevance/
review recommendation → user confirmation before sharing.

This is a direction to evaluate, not permission to implement every stage. Neither visual
similarity nor batch-majority membership should authorize sharing. A private selfie might
look like the gathering; ambiguous context and personal intent can still require a person.
No embeddings, clustering, cross-user scoring, production decisions or review UX exist yet.

Time could support chronological sorting, moment/burst grouping or cross-user same-moment
corroboration. GPS could support context/grouping. Those are future uses, not current gates.

## Evaluation baseline and labels

Baseline 0 is all user-selected photos: the no-relevance-filter comparator. It measures
what intelligence adds beyond the person's first selection. Its conceptual “share all”
outcome is a counterfactual risk comparison, never the current upload behavior; uploads
remain private and sharing needs confirmation.

Ground truth uses human contextual judgment: belongs / does_not_belong / ambiguous.
Never label by inside/outside a host window or by a metadata score. Important cases:
same-time unrelated screenshot/private selfie, clearly related before/after photos,
same-location different activity, food/scenery without people, downloaded images mixed
into selection. Missing EXIF is not inherently ambiguous or unrelated.

Next: intentionally collect selected-photo batches, label without predictions, freeze
event/batch-separated evaluation data, measure all-selected. Then consider whether
visual evidence can improve relevance without sacrificing precision/privacy. No new
time/GPS tuning is requested. Previously uploaded samples are not automatically an eval set.

## Repository reference audit

Search: starts_at, ends_at, event window, time score, time threshold (plus related prose).

| Location | Classification | Treatment |
|---|---|---|
| Create page, EventHeader, lib/api.ts, schemas.py | Obsolete product assumption | Remove exact-time fields; optional event_date display/contract |
| models.py and migration 0004 | Legacy storage/context | Nullable old times, no order gate, preserve values; SQL DATE added |
| events.py expiry | Supporting lifecycle metadata | New expiry anchored to creation, not gathering boundaries; no enforcement |
| migration 0001 | Historical schema | Immutable migration history; superseded by 0004 |
| security/participants/photos routes | Current product authorization | Event/role/approval/ownership only; no time dependency |
| evaluation scoring/config/synthetic fixture/tests | Legacy/historical experiment | Preserve formulas and regression; explicit opt-in, no further tuning |
| evaluation dataset/CLI | Current evaluation | Event ID sufficient; all-selected default, no required time/GPS |
| report 004, learning 004 | Historical hypothesis/evidence | Prominent supersession notice; results not erased or relabeled |
| original-brief, prompt 001, ADR 002 | Historical product requirement | Mark superseded for exact-time/relevance assumptions, retain provenance |
| README, learning 001/002, label guide | Current guidance | Replace obsolete required-time language; link this decision |
| photos metadata.ts/selection.ts and captured_at | Supporting metadata | Preserve explicit-offset parsing; no membership gate |

Decision/migration reasoning: [ADR 005](../adr/005-event-boundaries-are-not-membership.md).
