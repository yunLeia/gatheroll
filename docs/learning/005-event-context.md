# 005 — 시간 경계보다 사용자의 선택과 모임 맥락

## 문제 / 결정

기존 생성 폼은 시작·종료 시각을 요구했다. 그런데 참여자는 이미 자기 camera roll에서
후보를 직접 고른다. 모임 직전 준비/귀가 사진도 관련될 수 있고, 같은 시간의 스크린샷이나
사적 셀피는 무관할 수 있다. 시간 일치를 정답으로 삼으면 제품이 잘못된 일을 정확히 한다.
이제 이름만 필수이고 날짜·장소는 선택이다. 미래 relevance는 시각/맥락 가설이며 아직 AI는 없다.

## 파일에서 작동하는 방식

- `app/events/new/page.tsx`: datetime-local 두 개 대신 선택 date 하나. UTC 변환 없이
  YYYY-MM-DD를 보낸다. 공란은 null이다. 호스트는 경계를 만들어 낼 필요가 없다.
- `features/events/date.ts`: calendar date를 UTC 고정 포맷으로 표시한다. 날짜를 순간으로
  해석해 미국/한국 기기에서 전날/다음 날로 이동시키지 않는다. 날짜가 없으면 안 보여준다.
- `schemas.py`: event_date는 선택 날짜, 오래된 starts_at/ends_at 입력은 extra=forbid로
  422다. 응답에서도 없앴다. 조용히 무시하면 오래된 클라이언트가 저장됐다고 착각한다.
- `0004_optional_event_context.py`: 과거 timestamptz 값은 그대로 nullable, event_date 추가,
  과거 시간순서 제약 제거. 기존 사진/참가자/token/expiry에 UPDATE/DELETE를 하지 않는다.
- `events.py`: 새 expires_at은 created_at+retention_days. 이것은 lifecycle bookkeeping이며
  관련성이나 허용/거절 조건이 아니다. 자동 삭제/만료 집행은 여전히 미구현이다.
- `evaluation/cli.ts`: all_selected가 기본. timestamp 비교는 명시적 historical 옵션에서만.
  과거 수치를 지우지 않고 “초기 가정이 왜 바뀌었는가”를 설명할 증거로 보관한다.

## 가장 단순한 대안과 tradeoff

기존 timestamp를 날짜로 잘라 backfill하면 쉬워 보인다. 하지만 DB는 절대시각만 있고
원래 host timezone이 없으므로 실제 의도한 날짜를 확신할 수 없다. 그래서 날짜는 null로
남기고 과거 값만 보존했다. 또 다운그레이드로 NOT NULL을 복원하려면 새 이벤트의 시각을
꾸며 내거나 데이터를 지워야 한다. 0004 downgrade는 변경 전에 실패하며, 복구는 검토한
백업/새 forward migration으로 한다. 무손실 upgrade와 자동 downgrade는 같은 말이 아니다.

단순한 metadata 단서를 약화시키면 모델 문제가 더 어려워지고 사람 review/공유 동의가
중요해진다. 그것이 실제 제품 문제다. visual similarity도 사적 의도를 확정하지 못한다.
다음은 실제 선택 배치를 맥락으로 라벨링하는 일이지, 시간 threshold를 다시 조절하는 일이 아니다.

검증: 전용 PostgreSQL schema에 0003 자료를 넣고 0004 후 행 전체가 같은지 비교한다.
새 이벤트의 무시간 생성/날짜·장소 공란/Public·Private/승인/사진 회귀를 함께 돌린다.
샘플 사진 업로드를 평가 데이터 사용 동의로 간주하지 않는다.
