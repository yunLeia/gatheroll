# Gatheroll 학습 노트 005: 참가자 맞춤형 업로드 선호도

이번 구현은 **앞으로 사진 필터링이 필요할 기초를 만드는** 단계다. 이번에는
자기 사진이나 스크린샷을 제외할지 선택하는 선호도만 저장한다. 실제 필터링과
자동 제거는 아직 없다. ADR 006과 소스 코드에서 자세히 보자.

## 1. 왜 새로운 테이블이 아니라 participants에 컬럼을 넣는가?

`models.Participant`에 `include_selfies: bool`과 `include_screenshots: bool`을
직접 저장한다 (migration 0005). 지금은 하나의 참가자가 정확히 하나의 선호도만
가지므로 1:1 관계다. 별도 settings/profile 테이블을 만들면 향후 JOIN과 nullable
처리가 늘어난다. 일반적인 설정 프레임워크가 정말 필요할 때까지 미룬다는 YAGNI
원칙이다. 나중에 필요하면 쉽게 마이그레이션할 수 있다.

## 2. 왜 `/participants/me/preferences`인가?

`PATCH /events/{share_token}/participants/me/preferences`는 경로에 참가자 ID를
포함하지 않는다. 대신 Bearer token으로 자신을 식별한다 (participants.py 118줄).
`security.require_participant` 의존성이 토큰 해시+행사로 참가자를 찾고 다른
행사/호스트 토큰/없는 사람은 통과하지 않게 한다. URL에 ID가 없으므로 "한 참가자가
다른 참가자의 선호도를 바꿀 수 없다"가 인증 검사가 아니라 **구조적으로
불가능**하다. 구조로 정책을 지키는 것이 검사 로직보다 버그 위험이 적다.

`GET .../me`도 같은 패턴을 쓴다. 이를 재사용하면 일관성 있고 새로운 ID 검증
로직이 생기지 않는다.

## 3. 선호도의 기본값은?

`include_selfies`는 기본 `true`, `include_screenshots`는 기본 `false`다
(migration 0005, participants.py 49–50줄). 참가자가 선호도를 설정하지 않으면
자기 사진(보통 들어올 의도로 찍음)은 포함하고, 스크린샷(대화창이나 무관
내용일 가능성)은 제외한다. 이 기본값은 미래 사용자 증거가 나올 때 조정할 수
있다. 새 참가자는 JOIN 시점에 명시적으로 이 값으로 설정된다.

## 4. 보류 중인 참가자도 선호도를 설정할 수 있는가?

그렇다. 호스트가 아직 승인하지 않은 pending 참가자도 PATCH 요청을 보낼 수
있다. 이것은 안전하다. pending 참가자는:
- 다른 참가자의 비공개 사진을 볼 수 없다
- 업로드한 사진(아직도 private)에 다른 참가자가 접근할 수 없다
- 호스트 기능을 쓸 수 없다

자신의 선호도를 알리는 것만으로는 공격 표면이 생기지 않는다. 오히려 호스트가
나중에 참가자를 승인하면, 그들은 이미 자신의 선호도를 기록해 두었다.

같은 이유로 `security.require_participant`는 참가자의 status를 전혀 검사하지
않는다. 그래서 host가 거절(rejected)한 참가자도 이 엔드포인트를 계속 호출할 수
있다. pending과 마찬가지로 안전하다: 상태와 무관하게 이 엔드포인트는 본인의
선호도 외에 아무 권한도 주지 않는다.

## 5. 왜 frontend가 매번 선호도를 묻지 않는가?

`intake-panel.tsx`에서 `preferencesConfirmed` 로컬 상태를 추적한다 (68줄).
사진을 선택했을 때 (`selected > 0` && `!preferencesConfirmed`) 처음 한 번만
`PreferencesPanel`을 표시한다 (430–438줄). 선호도를 저장하면
`setPreferencesConfirmed(true)`로 설정해서 다음 사진 배치부터는 패널을 보이지
않는다 (305줄).

매 배치마다 다시 묻으면 인터페이스가 지루하고 사용자가 같은 결정을 반복한다.
선호도는 한 번 설정하면 그 행사 내내 유지할 것으로 가정한다. 새로고침하면 DB
저장값을 읽어서 `participant.include_selfies/include_screenshots`로 UI에
표시된다 (432–435줄).

## 6. 이번에는 필터링이 일어나지 않는다

선호도를 저장하는 것과 그걸 **적용**하는 것은 다르다. 이번 구현은:
- DB에 boolean 컬럼을 만들고
- API endpoint로 읽고 쓰고
- frontend에 표시하고
- 기본값을 설정한다.

하지만 "upload"를 할 때 선호도를 확인해서 사진을 필터링하지 않는다. 앞으로
AI나 규칙 엔진이 이 컬럼을 읽을 때 처음 의미를 가진다. 지금은 **저장된 정보**일
뿐이다. "자동 셀카 제거"나 "스크린샷 자동 필터링"이라고 말하면 틀렸다.

## 7. API 계약

| Method | Path | 역할 | 결과 |
| --- | --- | --- | --- |
| GET | `/events/{share}/participants/me` | Participant Bearer token | 현 상태 (include_selfies, include_screenshots 포함) |
| PATCH | `/events/{share}/participants/me/preferences` | Participant Bearer token | 업데이트된 본인 상태 반환 |

`ParticipantResponse` (schemas.py 52–60줄)는 id, display_name, status, joined_at,
approved_at에 더해 `include_selfies`와 `include_screenshots`를 포함한다.
`ParticipantPreferencesUpdate` (63–66줄)는 PATCH 입력이며 두 boolean만 받는다.

`ParticipantResponse`가 커졌기 때문에, 호스트가 쓰는
`GET /events/{share}/participants` (참가자 목록)도 이제 각 참가자의
선호도 두 필드를 함께 반환한다. 참가자는 자신의 선호도만 바꿀 수 있지만,
호스트는 (다른 필드와 마찬가지로) 목록에서 읽을 수 있다.

## 8. 실제 요청 경로

1. `IntakePanel`은 `participant.include_selfies/include_screenshots`를 받는다
   (props 파라미터).
2. 사진 선택 후 처음 `PreferencesPanel`이 표시되고, 사용자가 토글을 조정한다.
3. "Continue" → `savePreferences(prefs)` → `api.updatePreferences(share, token, prefs)`
   (lib/api.ts 기점).
4. `PATCH /events/{share}/participants/me/preferences`로 Bearer token과 JSON을
   보낸다.
5. 서버: `security.require_participant`가 토큰 검증, `update_my_preferences` (participants.py
   118줄)가 행을 갱신하고 COMMIT.
6. 응답: 업데이트된 `ParticipantResponse`.
7. frontend: 로컬 상태 `preferencesConfirmed` true, 다음 배치부터 패널 숨김.

클라이언트가 event_id나 participant_id를 임의로 입력하지 못한다. acting
participant는 토큰에서만, event는 검증된 토큰의 관계에서만 나온다.

## 9. 데이터 완전성과 기본값의 보장

- migration 0005: `nullable=False, server_default=true()/false()` — 기존 행도
  기본값이 설정되고 NULL이 생기지 않는다.
- models.Participant: `Mapped[bool]` — nullable이 아닌 bool 타입.
- `join_event` (participants.py 49–50줄): 새 참가자는 명시적으로 기본값 설정.
- 이 조합이 데이터 무결성과 null 체크 생략을 보장한다.

## 10. 이후 단계

선호도가 저장된 지금, 다음 작업은:
- 실기기에서 UI 흐름 재검증 (docs/testing/ 아래 문서는 아직 없음)
- 작은 golden dataset과 label 기준으로 event-relevance baseline 만들기
- 기준에서 `include_selfies/include_screenshots` 신호의 영향 측정
- 기본값 조정 여부 결정

metadata-only baseline 이전에 AI 모델/embedding/pgvector는 필요 없다.
