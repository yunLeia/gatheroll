# Gatheroll working agreement

Read `docs/STATUS.md` at the start of each task. Read only the product/spec/ADR
sections relevant to the task; the full source brief is `docs/product/original-brief.md`.
The brief is product direction, not permission to implement every future feature.
Later explicit user instructions take precedence. Approved slice prompts live in docs/prompts;
use docs/STATUS.md to distinguish current behavior from older slice constraints.

## Product invariants
- Gatheroll means gather + camera roll: reduce coordination after group events.
- Mobile web first, no mandatory signup; broad explicit photo selection later.
- Privacy: uploaded is not shared. AI recommends; the user confirms sharing.
- Precision before recall. Establish golden labels and metadata baselines before embeddings.
- No automatic camera-roll access, no invented metrics, no LLM for every image.
- Neutral camera-roll UI; no film aesthetic or social feed.
- Add dependencies and infrastructure only for a concrete current need.

## Workflow and context
- Work on one bounded vertical slice. Inspect current code before editing.
- Keep output compact: targeted rg searches, short logs, relevant files only.
- At meaningful stopping points update `docs/STATUS.md` with implemented behavior,
  verified commands, blockers and next step. Do not rely on chat memory alone.
- Record meaningful decisions in `docs/adr/` as they happen.
- Update `docs/learning/` with practical Korean explanations tied to actual files:
  problem, mechanism, rationale, simplest alternative, main failure/tradeoff.
- Preserve existing work and secrets; never commit `.env`, photos, DB files or tokens.
- Run web lint/typecheck/build and backend Ruff/mypy/pytest for relevant changes.
  DB tests use a dedicated PostgreSQL test database and Alembic, never production.
- Report actual checks and limitations. Do not claim CI/deployment passed without evidence.
- Do not implement the next slice until requested.
