# Gatheroll 학습 노트: 호스트 권한과 참가 승인

이번 범위는 계정 없이 행사에 참여하고, 비공개 행사에서는 호스트가 입장을
결정하는 과정이다. 사진 저장이나 공유는 아직 없다.

## 도메인: Public은 검색 공개가 아니다
`domain.py`의 JoinPolicy는 `open` / `approval_required`다. Public/Private는
UI 설명이고, 실제 서버가 판단할 행동은 즉시 승인할지 대기시킬지다.
`is_public`이면 검색 공개·사진 공개·가입 허용 중 무엇인지 모호해진다.
모든 행사는 unlisted이고 목록/검색 API가 없다. 페이지는 noindex로 표시하지만
그것은 검색엔진에 대한 요청일 뿐 보안 장벽은 아니다. 링크를 가진 사람은
참여 전 행사 제목·선택 날짜·장소를 볼 수 있다. 정확한 시작/종료 시각은 요구하지 않는다.
참가자 목록은 호스트에게만 보인다.

## 세 토큰의 목적
| 토큰 | 역할 | DB 저장 | 어디로 보내는가 |
| --- | --- | --- | --- |
| share_token | 행사 초대 페이지 찾기 | 원문 | /e/토큰과 QR |
| manage_token | 해당 행사의 호스트 권한 | SHA-256 해시만 | Authorization: Bearer |
| participant_token | 해당 행사 안의 참가자 신원 | SHA-256 해시만 | Authorization: Bearer |

`events.py`는 생성 시 EventCreated(event=..., manage_token=...)를 반환한다.
`schemas.py`의 일반 EventResponse에는 호스트 토큰/해시가 없다.
`participants.py`도 가입 응답 ParticipantJoined에서만 참가자 토큰을 반환한다.
서버는 이후 원문을 복구해 보내줄 수 없다.

share_token은 공개 초대 식별자이므로 원문으로 조회한다. 비밀 토큰은 DB가
유출되었을 때 즉시 사용할 수 있는 원문 자격증명을 노출하지 않도록 해시로
저장한다. `security.py`는 secrets.token_urlsafe(32)로 256비트 난수를 만들고
SHA-256으로 검증값을 만든다. 사람이 정하는 비밀번호는 사전 공격이 가능해서
느린 password hash가 필요하지만, 충분히 무작위인 토큰은 같은 상황이 아니다.
해시는 토큰 도난 자체를 막지 않는다. 원문을 가진 사람이 그 권한을 얻는다.

## 인증과 인가를 분리하기
`require_participant`는 토큰 해시와 event_id를 함께 조회한다. 이 브라우저가
어느 참가자인지 확인하는 인증이다. pending/rejected도 자신의 상태는 읽는다.
향후 업로드는 인증 후 `participant.status == approved`를 추가로 확인해야 한다.
그것이 인가다. 프론트의 승인 표시만 믿으면 공격자가 API에 직접 요청해
대기 중에도 사진을 올리거나 다른 행사에 접근할 수 있다.

`require_host`는 해당 행사 manage_token_hash와 요청 토큰 해시를 constant-time
비교한다. 다른 행사 호스트, 참가자, share_token은 모두 관리 권한이 아니다.
참가자가 자신의 status를 가입 JSON에 넣으면 스키마가 거부하며, 서버가 행사
정책을 읽고 상태를 결정한다. 검증은 UI와 별개로 항상 API에서 실행한다.

## DB 관계와 마이그레이션
`models.py`: 하나의 Event에 여러 Participant가 속한다. participants.event_id는
events.id를 참조하는 외래 키이고 event_id 인덱스는 행사별 목록 조회에 사용된다.
표시 이름은 사람이 읽는 이름이므로 중복 가능하다. 신원은 이름이 아닌 토큰이다.
호스트는 자동으로 participants 행이 되지 않는다.

`0002_event_access.py`가 기존 events에 join_policy와 manage_token_hash를 더하고
participants 테이블을 만든다. `alembic upgrade head`로 기존 DB에 적용한다.
이전 행사에는 발급된 호스트 토큰이 없으므로 hash=NULL로 보존하고 관리 요청을
거부한다. 안전한 소유자 확인 방법이 없어 임의 회수/재발급 API는 만들지 않았다.
관리 가능한 새 행사를 생성한다. migration downgrade는 참가 데이터를 삭제하므로
실제 사용 DB에서 가볍게 실행하지 않는다.

## 상태 불변식과 재시도
```text
Private: join → pending → approved
                       ↘ rejected
Public:  join → approved
```
approved이면 approved_at이 있고 pending/rejected이면 없다. DB CHECK가 이
조합을 강제한다. 승인/거절은 pending에서만 가능하다. 같은 결정 재전송은 같은
결과와 원래 approved_at을 반환하고 반대 결정은 409를 반환한다.
PATCH 처리에서 SELECT FOR UPDATE로 행을 잠가 두 호스트 요청이 동시에
서로 다른 결정을 내리는 경합을 직렬화한다. 계정 없이도 여러 탭이 생길 수 있다.
승인 취소/강퇴/재신청 정책은 아직 없으며 다음에 필요하면 명시적으로 설계한다.

## 브라우저 복원과 보안 절충
`lib/credentials.ts`가 역할+행사별 localStorage 키를 관리한다. 참가자 페이지는
새로고침하면 저장 토큰으로 /participants/me를 호출하고 가입 폼을 다시 보내지
않는다. 호스트 링크는 /manage/share#token=...이다. fragment는 HTTP 경로로
전송되지 않는다. 페이지는 저장 후 주소창 fragment를 제거한다.
초대 QR와 복사 링크는 별도 inviteLink 함수가 /e/share만 만든다.

localStorage는 같은 origin의 JavaScript가 읽는다. XSS가 있으면 토큰 도난이
가능하다. 인증 프레임워크나 BFF를 이번에 추가하는 대신 이 선택을 격리했다.
향후 같은 사이트의 HttpOnly 쿠키 세션을 검토할 수 있지만, CSRF/CORS/배포
설계가 함께 필요하다. 저장이 막히면 메모리로 현재 탭을 유지하고 유실 경고를
보여준다. 저장소 삭제/다른 기기 이동 시 자동 복구는 없다. 호스트는 별도 비밀
관리 링크를 안전한 곳에 보관해야 한다. QR에 넣거나 게스트에게 보내면 안 된다.
서버 응답은 no-store이며 referrer를 제한한다. 로깅/분석 도구에 토큰·요청 body·
Authorization·관리 fragment를 기록하면 이 설계가 무의미해질 수 있다.

## 폴링과 UI 구조
`lib/use-polling.ts`는 완료 후 5초 뒤 다시 요청해 중복 진행을 방지한다.
숨겨진 탭은 멈추고, 페이지 해제 시 AbortController와 timer를 정리한다.
호스트는 참가자 목록을, 대기 참가자는 자신의 상태를 조회한다. 최종 상태면
참가자 폴링을 끝낸다. 5초 정도의 지연과 요청 비용을 받아들이고 인프라를
간단하게 유지했다. WebSocket/SSE는 실제 필요/측정 후 검토한다.

`app/`는 경로, `features/events`는 행사 정보/관리 페이지,
`features/participants`는 가입과 호스트 목록, `lib/api.ts`는 HTTP 계약을 맡는다.
일반 CRUD 저장소 계층이나 전역 상태 라이브러리는 필요하지 않았다.
모바일은 48px 이상 버튼, 16px 입력, 큰 정책 선택 카드, 256px 고대비 QR,
한 열 참가자 카드, safe-area 여백과 하단 생성/가입 동작을 사용한다.

## 요청 순서와 실패 지점
1. 호스트 POST /events: 정책 검증 → DB에 행사+호스트 해시 commit → 원문 토큰 반환.
   응답을 잃으면 호스트 권한도 잃을 수 있다. 생성 idempotency/recovery는 미구현.
2. 게스트 QR → GET /events/share: 없으면 404. 네트워크/API 오류면 재시도 화면.
3. POST participants: 이름 검증 → 서버 정책 결정 → pending 저장 → 참가자 토큰 반환.
   응답 유실 뒤 재전송은 중복 요청을 만들 수 있다. 이름을 중복 방지 키로 쓰지 않는다.
4. 호스트 GET participants: Bearer 검증 → event_id별 목록. 잘못된 토큰은 401/403.
5. 호스트 PATCH participant: 권한·행사 일치 → 행 잠금 → 상태 전이 → commit.
   없는 대상은 404, 반대 최종 결정은 409, 저장 오류는 503. 같은 결정은 재시도 가능.
6. 게스트 GET me: 토큰+행사 확인 → approved 반환 → UI가 변경. 다음 조회까지 지연 가능.
   일시 오류에는 기존 상태를 유지하고 재시도하며 인증 실패에는 접근 오류를 표시한다.

## 다음 단계 전에 스스로 설명할 것
- Public과 private 사진 공개는 왜 별개인가?
- 참가자의 이름을 안다는 것이 왜 인증이 아닌가?
- DB 해시만 알아서는 왜 원문 토큰을 복구할 수 없는가?
- 가입 시 클라이언트가 승인 상태를 보내면 어떤 문제가 생기는가?
- 승인 PATCH가 응답을 잃었을 때 재시도하면 무엇이 유지되는가?
- 브라우저 저장소를 지우면 어떤 역할/권한을 잃는가?

관련 결정: `docs/adr/003-event-access-and-no-account-authorization.md`.
