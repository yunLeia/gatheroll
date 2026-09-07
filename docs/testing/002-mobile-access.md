# Mobile access verification — 2026-09-06

## Automated / desktop browser evidence
- PostgreSQL: 26 tests passed, covering policies, raw-secret separation, hashes,
  role/event isolation, own status, approval/rejection persistence and retries,
  direct DB timestamp invariants, CORS and previous event validations.
- Browser credential helper: 6 Node tests passed (role/event keys, blocked storage,
  clearing, fragment cleanup, invite/management separation, malformed token rejection).
- Applied 0002 to development/test DBs; 2 existing development events remained intact
  with NULL management verifiers. Alembic check reported no model/schema drift.
- In-app browser, separate host/guest tabs (same browser profile; not isolated devices):
  - Private creation defaults correctly, opens host page with QR and empty list.
  - Join → pending → refresh preserves pending without resubmitting.
  - Host list automatically discovers request; approve → guest polling shows “You’re in.”
  - Public selection → join immediately shows “You’re in.”; host list shows Joined.
  - Host management URL reload restores access from browser storage.
  - Reject → guest polling shows rejection; a reload preserves that state.
  - After the URL fix, a newly created event enters a clean management URL and reloads
    without reintroducing the fragment.
  - Copy invite button shows success; browser tool clipboard retrieval was unavailable,
    so the copied payload was not independently read back. Link separation has unit tests.
- Measured 375px host: scrollWidth=375, QR=256px, smallest app button=52px.
  390px approved guest: scrollWidth=390. 430px host: scrollWidth=430.
- During development/HMR, intermittent browser network TypeErrors appeared. API health
  and event requests returned 200; the retry UI recovered. Underlying network cause
  was not established. Development logs record only error category/status, never secrets.
- Found and corrected a Next.js fragment restoration issue: creation now stores the
  token before clean-route navigation; incoming capability links clean both browser
  history and Next's router state.

## Physical device check — core flow user-confirmed
The user reported iPhone/Safari QR participation through approval, photo upload and
photo retention after refresh. The agent did not operate the phone. Device/version,
separate join-policy cases and lifecycle edge cases remain unverified; see test
record 003. The checklist below retains unconfirmed detailed cases.

### Same-Wi-Fi development setup
Use synthetic events only. A phone's localhost points to the phone, not the Mac.
Find the Mac Wi-Fi address in system settings (or `ipconfig getifaddr en0` if en0 is
the active interface). Replace 192.168.1.20 below with the actual address.
Stop the currently running web/API dev processes in their terminals before restarting
on the same ports. Do not run two Next processes against the same .next directory.

API terminal (`apps/api`, virtual environment active):

```bash
GATHEROLL_WEB_ORIGIN=http://192.168.1.20:3000 uvicorn gatheroll_api.main:app --reload --host 0.0.0.0
```

Web terminal (`apps/web`):

```bash
NEXT_PUBLIC_API_BASE_URL=http://192.168.1.20:8000 npm run dev -- --hostname 0.0.0.0
```

Open `http://192.168.1.20:3000/events/new` on the host device too, so the generated
QR uses the reachable address. Both devices must use that same origin; localhost
is a separate browser storage origin. Firewall/Wi-Fi client isolation may prevent
access. These commands expose dev servers to the local network only for testing;
use HTTPS for any real hosted event. HTTP may disable Clipboard API; the UI offers
a selectable link fallback. Never put a private management link into a guest QR.

### Acceptance checklist
- [ ] Phone B camera scans the actual displayed QR on device A and opens the correct event.
- [ ] Private: name → pending; refresh stays pending; A approves; B updates automatically.
- [ ] Private rejection is respectful and persists on B's reload.
- [ ] Public: name → immediate entry without a host action.
- [ ] Host reload retains management. Private host link opens on a new trusted browser.
- [ ] 375/390/430px or equivalent phones: no horizontal overflow; native inputs usable.
- [ ] Background/foreground cycle restores polling; final state stops participant polling.
- [ ] Clipboard invite contains only /e/share; never a management fragment.
- [ ] Note device/browser versions, network, scan distance, failures and any changed decisions.

Record the actual result here before marking physical QR verification complete.
