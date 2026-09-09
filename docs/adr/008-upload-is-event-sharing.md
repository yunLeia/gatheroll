# ADR 008: Upload is the event-sharing action

Status: Accepted — 2026-09-08, explicit user correction.

## Decision

Participants select photos and complete upload to share them with the event.
There is no separate post-upload confirmation or private staging review step.
AI suggestions do not automatically remove photos or decide permission to share.
Event sharing still requires event-scoped authorization and private object storage;
it does not make photos publicly accessible on the internet.

This supersedes the separate sharing-confirmation requirement in AGENTS.md,
ADR 004, ADR 007 and earlier product proposals. Their implementation history
remains accurate for the code that was built.

## Implementation boundary

The subsequent user-approved shared-album slice implements this rule for the
host and every approved participant, including existing completed uploads.
See ADR 009. The `uploaded_private` storage lifecycle value and uploader-scoped
contribution endpoint remain compatible; separate album routes provide event
read access. Upload copy now communicates sharing before submission.

## Consequences

The gallery no longer depends on building a second sharing-confirmation flow.
Cleanup can suggest improvements before upload or annotate the album afterward;
post-upload classification cannot prevent a photo from being shared on upload.
The alternative was a private staging area followed by another confirmation,
which the user explicitly rejected as the product rule.
