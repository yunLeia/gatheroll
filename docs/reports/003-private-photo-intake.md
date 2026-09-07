# Step 003 완료 정리 — 비공개 사진 수집

## 이번 단계의 범위

승인된 참가자가 시스템 사진 선택기로 여러 사진을 고르고, 비공개 R2에 직접
업로드한 뒤 새로고침해도 본인의 완료된 사진을 다시 보는 흐름을 구현했다.
사용자의 기존 프론트엔드 수정과 디자인을 유지했다.

**Uploaded ≠ Shared.** AI, 공유 앨범, 호스트의 참가자 사진 열람은 없다.

## 구현 파일과 역할

- `apps/api/migrations/versions/0003_private_photos.py`: photos 테이블.
- `apps/api/src/gatheroll_api/models.py`, `domain.py`: 소유권 FK, 상태, DB 불변식.
- `photo_schemas.py`, `photos.py`: 승인 인가, 배치 초기화, 완료 확인, 본인 목록.
- `storage.py`, `config.py`: 구체적인 R2 서명/HEAD 연동과 설정.
- `apps/web/features/photos/selection.ts`, `prepare.ts`: 선택 검증, EXIF, 썸네일.
- `upload.ts`, `api.ts`, `types.ts`: 동시성 제한, 재시도, HTTP 계약.
- `intake-panel.tsx`, `features/participants/join-panel.tsx`: 승인 후 모바일 UI.
- `diagnostics.ts`, `diagnostic-panel.tsx`: 비밀정보 없는 개발 로그와 폰용 표시.
- `apps/web/next.config.ts`: 사용자가 추가한 LAN 개발 호스트 허용 설정 보존.
- README, STATUS, ADR 004, 한국어 학습 노트 003, 모바일 검증 문서 업데이트.

## 저장·API·보안

```text
브라우저 ── 메타데이터/참가자 인증 ──→ FastAPI ──→ PostgreSQL
브라우저 ←──── 짧은 PUT 서명 URL ──── FastAPI
브라우저 ── 원본·썸네일 바이트 ─────────────────→ 비공개 R2
브라우저 ── 완료 요청 ──────────────→ FastAPI ── HEAD → R2
```

DB 상태는 `pending_upload → uploaded_private` 두 개다. 완료 상태에는
uploaded_at이 반드시 있다. 실패한 전송은 DB pending, 브라우저 failed로 남는다.
원본/썸네일 키, 파일 타입/크기/이름, nullable 촬영시각·GPS·크기 등을 저장한다.
부모 삭제는 DB FK로 막으며, 자동 객체 정리나 연쇄 삭제는 추가하지 않았다.

모든 사진 API는 행사에 속한 approved participant token을 요구한다.
event/participant ID와 임의 object key를 클라이언트가 지정할 수 없다.
호스트도 참가자의 비공개 사진에 접근할 수 없다.

`/events/{share}/photos` 아래:

| API | 역할 |
| --- | --- |
| GET /limits | 서버 기준 선택 제한 |
| POST /uploads | N개 메타데이터 → DB 레코드 + 서명 PUT 대상 |
| POST /{id}/complete | 소유권·상태·R2 HEAD 확인 후 멱등 완료 |
| GET /?offset=0 | 본인 완료 사진 50개씩, 짧은 썸네일 GET URL |

참가자별 client UUID로 초기화 재시도가 같은 사진 레코드를 재사용한다.
PUT은 서버 key·타입·정확한 길이를 서명한다. GET은 썸네일만 반환하며 Next
이미지 최적화 프록시도 사용하지 않는다. 비밀 키는 ignored `.env`에만 둔다.

## 모바일·실패 처리

- 50장/배치, 25MiB/원본, 256KiB/썸네일, 500레코드/참가자: 설정 가능한 데모 제한.
- 동시에 3개 사진 작업. 한 사진의 원본과 썸네일은 순차 전송.
- 한 장씩 384px 긴 변 JPEG 생성. 디코딩이 안 되면 대체 표시 + 원본 업로드.
- JPEG/PNG/WebP/HEIC/HEIF 수용. 실제 iPhone HEIC의 제공 MIME/변환은 별도 미확인.
- EXIF 촬영시각은 명시적 offset이 있을 때만 UTC로 기록. GPS 누락은 부정 증거가 아님.
- 부분 실패 시 성공 사진은 건드리지 않고 실패 항목만 재시도.
- 성공한 PUT 체크포인트 유지: 완료 응답 유실 시 바이트 대신 완료 확인 재시도.
- HEAD 409로 없거나 다른 객체가 확인되면 체크포인트를 초기화해 재전송.
- 새로고침은 완료 사진을 복원하지만 미완료 File 선택은 복원하지 않음.

## 개발 로그 사용법

`npm run dev`에서 승인 후 사진 화면 아래 **Photo diagnostics**를 펼친다.
브라우저 콘솔에는 `[Gatheroll photo]` 접두사로 같은 기록이 나온다.
이 로그는 API 터미널 로그가 아니다. 서버로 보내거나 디스크에 저장하지 않는다.

| 이벤트 | 확인할 내용 |
| --- | --- |
| selection / prepare_file / prepare_batch | 선택 수·크기, 준비 시간, HEIC 여부, 미리보기 성공, 메타데이터 존재 여부 |
| upload_init / object_put / upload_complete | 단계별 성공/실패, 시간, PUT 크기 |
| photo_state / upload_batch | 파일 순번별 체크포인트, 완료·실패 수, 재시도 수, 성공한 PUT 바이트 합계 |
| list_loaded / list_failed | 새로고침·재조회에서 반환된 사진 수(현재 페이지 최대 50) |
| visibility / pagehide / pageshow | 백그라운드·복귀와 브라우저 페이지 캐시 신호 |

시간은 ms. PUT 바이트 합계는 성공 응답을 받은 전송만 세며 실제 네트워크 전체
트래픽과 같지 않다. 재시도 배치의 완료 수는 현재 선택 전체 기준 누적값이다.
준비 시간은 메타데이터+썸네일의 합이며 메인 스레드 정지 시간 측정이 아니다.
로그 최대 100개, 새로고침하면 초기화. OS의 강제 종료는 마지막 로그 자체를
남기지 못할 수 있다. 파일 이름·원문 시각·좌표·ID·토큰·서명 URL·오류 원문은
허용하지 않는다. production에서는 로그와 패널이 비활성화된다.

## 검증과 한계

- 백엔드 52개 테스트, Ruff/mypy, 전용 DB Alembic 검증.
- 프론트엔드 기존 16개 + 진단 개인정보/프로덕션 차단 테스트 1개.
- 실제 R2: 합성 원본 9 + 썸네일 9 저장, DB/HEAD 확인, 새로고침 복원.
- 데스크톱 합성 12MP PNG 10장 준비 1128ms; 9장 업로드 세션 7.3초.
  iPhone 성능 수치가 아니다. 375/390/430px 화면 가로 넘침 없음.
- 사용자 확인: iPhone/Safari에서 QR 참여→승인→사진 업로드→새로고침 후 유지.
- LAN 진단: API CORS Origin 일치와 Next allowedDevOrigins가 각각 필요했다.
- 실제 기기 모델/버전, HEIC 상세, 물리적 네트워크 실패 재시도·메모리/성능은
  별도 미검증. 자동 테스트 결과로 대체했다고 주장하지 않는다.
- 자동 보존기간 삭제, 파일 내용 검증, 체크섬/불변성 보장은 아직 없다.
  PUT URL은 만료 전 재사용 가능하므로 후속 AI 전에 불변 최종화를 검토해야 한다.
- 구현 커밋 `8595a73`을 기존 프론트엔드 커밋과 함께 main에 푸시했다.
  [GitHub CI 웹/API 모두 통과](https://github.com/yunLeia/gatheroll/actions/runs/34072793840).
  워크플로 액션의 Node 런타임 폐기 예정 경고는 실패가 아니며 별도 유지보수 항목이다.

## 다음 단계

로그로 남은 실기기 항목을 측정하고, 다음 요청에서 작은 동의 기반 golden
dataset과 metadata-only event relevance baseline을 설계한다. 지금 AI나 다음
슬라이스는 구현하지 않았다.

참고: [ADR 004](../adr/004-private-photo-intake-lifecycle.md),
[학습 노트](../learning/003-private-photo-intake.md),
[설정·검증 기록](../testing/003-private-photo-intake.md).
