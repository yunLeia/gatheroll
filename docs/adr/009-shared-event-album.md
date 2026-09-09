# ADR 009: One event album for host and approved participants

Status: Accepted — 2026-09-08. User explicitly corrected host-only scope and
requested implementation of the shared event album.

## Decision

Both roles use the same `GET /events/{share}/album` endpoint and `SharedAlbum`
component. Authorization accepts the event's host capability or an approved
participant capability bound to that event. Invite knowledge alone is insufficient.
Pending and rejected participants cannot list or download photos.

Completed uploads, including existing ones, are event contributions under the
corrected upload-is-sharing rule. Keep `uploaded_private` as the existing storage
lifecycle value: it describes private object storage, not exclusive uploader access.
No new confirmation step, migration, or artificial sharing cutoff is introduced.
The personal `/photos` list and upload/complete ownership checks remain intact.

## Read and download contracts

- Album: 50 photos per page with `next_offset`, ordered by `created_at, id`.
  Signed thumbnail URLs only; no original links, GPS, or object keys in list JSON.
- Original: `/album/{photo_id}/original`, authorized again on each request.
  Only completed photos from the authorized event are eligible. Default is an
  inline signed URL; `download=true` signs attachment disposition with an encoded
  filename. Storage serves all image bytes directly.
- One responsive grid, manual Refresh and Load more, accessible native dialog,
  on-demand original and download requests. Missing/unsupported previews fall back
  to an explanation and original download. Upload completion refreshes the uploader's album.
- Existing signed links remain bearer capabilities until their short TTL expires.
  Offset pagination assumes no photo deletion in this slice; a manual refresh
  reloads the first page and renews thumbnails.

## Alternatives and limits

A host-only gallery was rejected by the user: everyone approved belongs to the
same album. Overloading the personal `/photos` list would break its ownership
meaning and duplicate matching. Renaming the stored state would require a migration
and coordinated client changes without changing album behavior, so it is deferred.

No bulk ZIP, own-upload exclusion, moderation/deletion, polling, AI integration,
or new infrastructure in this slice. Full-size HEIC rendering is browser-dependent.
The current signed PUT overwrite limitation remains unchanged.
