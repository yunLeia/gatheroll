# Gatheroll 학습 노트: 기반과 첫 이벤트 흐름

## 먼저 볼 파일
- `apps/web/app/events/new/page.tsx`: 폼, 로컬 시각 → ISO UTC 변환, POST, 이동
- `apps/web/app/e/[shareToken]/page.tsx`: 토큰으로 GET, 로딩/404/오류/재시도
- `apps/api/src/gatheroll_api/events.py`: 입력/출력 계약과 저장 흐름
- `apps/api/src/gatheroll_api/models.py`: 테이블과 Python 객체의 대응
- `apps/api/src/gatheroll_api/database.py`: 연결 풀과 요청별 Session
- `apps/api/migrations/versions/0001_events.py`: 실제 테이블 생성 SQL의 이력

## PostgreSQL과 SQLAlchemy
PostgreSQL은 별도 서버다. 디스크에 행을 저장하고 유일성·제약조건·트랜잭션을
지킨다. SQLAlchemy는 API 프로세스 안의 Python 라이브러리로, Event 객체와
select(Event)를 INSERT/SELECT SQL로 바꾸고 psycopg가 이를 DB에 전달한다.
ORM 모델 Event의 각 Mapped 필드는 열과 대응한다. 객체가 곧 영구 저장은 아니다.
직접 SQL을 쓰는 대안도 있지만 현재는 타입과 객체 매핑이 읽기 쉬워 ORM을 선택했다.

## 세 종류의 스키마
EventCreate(Pydantic)는 외부 입력을 검증한다: 공백 제목, 시간 역전, 좌표 범위,
시간대 없는 입력을 거부한다. Event(SQLAlchemy)는 DB 저장 구조다.
EventResponse(Pydantic)는 응답으로 공개할 필드를 정한다. 입력자가 id나 토큰을
고르지 못하게 하고, 향후 내부 필드가 생겨도 실수로 공개하지 않도록 분리했다.

## POST가 저장되는 과정과 트랜잭션
FastAPI가 입력을 검증 → 서버가 UUID와 secrets.token_urlsafe(32) 생성 →
Session.add로 새 객체 등록 → commit에서 INSERT를 flush하고 COMMIT →
refresh로 저장된 행을 읽음 → 응답 스키마를 거쳐 201 JSON 반환.
트랜잭션은 저장 작업을 성공/실패 한 단위로 다룬다. commit 전 실패한 변경은
세션 종료 시 롤백된다. commit 후 응답이 유실되면 저장은 되었을 수 있다.
현재 자동 재시도는 없으며, 추후 idempotency key로 중복 생성을 해결할 수 있다.

## 모델을 고쳤는데 왜 migration이 필요한가?
Python 클래스 수정은 이미 만들어진 테이블에 ALTER TABLE을 보내지 않는다.
Alembic은 순서가 있는 변경 파일과 DB의 alembic_version으로 적용 상태를 추적한다.
설정은 apps/api/alembic.ini, 연결/메타데이터는 migrations/env.py에 있다.
모델 수정 → `alembic revision --autogenerate -m "설명"` → 생성 SQL 검토 →
`alembic upgrade head` → 테스트 순서로 작업한다. 자동 생성은 이름 변경이나
데이터 이전 의도를 모두 알지 못하므로 반드시 사람이 검토한다.
`alembic check`는 현재 모델과 DB 차이를 검사한다. downgrade는 데이터 손실 가능.

## 토큰과 404
서버의 안전한 난수 생성기로 32바이트(256비트) 토큰을 만든다. 순차 ID로 다른
이벤트를 추측하는 일을 막고 모든 클라이언트가 같은 규칙을 따르게 한다.
DB unique 제약도 중복을 막는다. 테스트의 표본 유일성 확인은 암호학적 증명이
아니며 보안성은 secrets 생성기에 근거한다. 토큰은 호스트 관리 권한이 아니다.
모르는 토큰은 404와 `{code: "event_not_found", message: ...}`를 반환한다.
200 null은 리소스를 찾았는지 실패했는지 클라이언트가 별도로 추측하게 만든다.

## 실제 요청 경로
브라우저가 Next.js에서 화면/JS를 받는다. JS가 FastAPI로 직접 POST를 보낸다.
따라서 이벤트 API 요청 자체는 Next.js 서버를 경유하지 않는다.
FastAPI → Pydantic → SQLAlchemy Session → psycopg → PostgreSQL →
SQLAlchemy Event → Pydantic 응답 → 브라우저 → /e/토큰 이동 → GET → 화면 표시.
두 origin을 사용하는 브라우저 요청이라 CORS의 허용 origin과 POST 설정이 필요하다.
CORS는 브라우저 정책이며 인증이나 서버 접근 통제의 대체물이 아니다.

## 주요 실패 지점
- 잘못된 입력: 프론트 기본 검사 + API 422. DB에도 핵심 제약조건을 둔다.
- DB 미실행/미적용 migration: DB 예외를 일반적인 503으로 응답한다.
- API URL/CORS 오설정: 브라우저 요청 실패. 환경 변수와 origin을 확인한다.
- 네트워크/응답 지연: 15초 제한과 안내. 생성의 모호한 실패는 중복 위험이 있다.
- 없는 토큰: 404 안내. 서버 오류와 구분한다.
- 시간대: 저장은 절대 시각, 화면은 보는 사람의 기기 시간대. 행사 시간대 보존은 미구현.

## 기반 기술 복습
FastAPI는 HTTP 라우팅·검증·OpenAPI 문서를 제공한다. Uvicorn은 HTTP 서버다.
TypeScript는 빌드 전 타입 오류를 찾지만 외부 JSON을 런타임 검증하지는 않는다.
Dockerfile은 API 실행 환경을 재현하고 non-root 사용자로 실행한다.
CI는 별도 Linux 환경에서 lint/typecheck/build/실제 DB 테스트를 반복한다.
프론트 lockfile은 npm ci로 재현한다. Python은 현재 버전 범위 방식이라 완전한
잠금이 아니며, 배포 전 lockfile을 도입할 여지가 있다.

## 직접 해볼 것
1. 두 브라우저 탭에서 생성한 URL을 열어 동일 이벤트를 확인한다.
2. API를 재시작하고 URL을 새로고침한다. DB 저장이 유지되는지 확인한다.
3. 끝 시간을 앞당겨 API 422와 화면 안내를 확인한다.
4. GET 응답과 DB events 행을 비교한다.
5. migration에 열 하나를 추가하는 연습은 별도 브랜치/테스트 DB에서 한다.
