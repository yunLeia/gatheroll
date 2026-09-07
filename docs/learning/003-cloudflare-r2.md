# 003 — Gatheroll의 실제 Cloudflare R2 구조

## 왜 사진을 DB에 넣지 않았나?

Cloudflare는 인터넷 트래픽 전달/보안과 개발자 인프라를 제공하는 회사이고 R2는 그중
object storage다. Gatheroll은 PostgreSQL에 소유자/이벤트/상태/메타데이터를, R2에
원본과 썸네일 bytes를 저장한다. DB는 관계와 트랜잭션에, object storage는 큰 파일을
key로 저장/조회하는 데 맞는다. 로컬 디스크는 가장 단순한 개발 대안이지만 서버 교체,
여러 인스턴스, 백업과 브라우저 다운로드를 직접 책임져야 한다.

## 실제 구성 요소

- Account: R2를 소유하는 Cloudflare 계정 범위. 실제 account ID를 문서에 넣지 않는다.
- Bucket: 객체 묶음/권한·CORS 설정 단위. 현재 개발 bucket은 `gatheroll-dev`.
- Object: 원본 또는 썸네일 bytes + content type 등 부가정보.
- Object key: bucket 안의 주소. 서버가 `events/{event_uuid}/photos/{photo_uuid}/original`
  또는 `thumb`을 만든다. 디렉터리처럼 보이지만 문자열 key다. 원본 파일명을 key로 쓰지 않는다.
- Endpoint: S3 API 요청 목적지. 기본 `https://<account-id>.r2.cloudflarestorage.com`.
  계정/관할별 endpoint는 설정으로 대체 가능하다. 공개 앨범 URL이 아니다.

코드 근거: `apps/api/src/gatheroll_api/config.py`, `storage.py`, photo 관련 routes/service.

## Credentials — 이름은 비슷해도 역할이 다르다

실제 환경변수는 아래 suffix 앞에 **GATHEROLL_**가 붙는다. API의 ignored `.env`에서
읽으며 설정과 SDK client는 process cache되므로 변경 후 API 재시작이 필요하다.

| Suffix | 목적/사용 위치 | 비밀 여부와 유출 위험 |
|---|---|---|
| R2_ACCOUNT_ID | 기본 endpoint 구성 | 비밀번호는 아니지만 계정 식별정보; 불필요한 공개 금지 |
| R2_ACCESS_KEY_ID | boto3가 사용할 credential 식별자 | 단독 서명 불가해도 credential 일부로 비공개 취급 |
| R2_SECRET_ACCESS_KEY | 요청/URL 서명 | 비밀. 유출되면 키 권한 범위 접근 가능; 폐기/교체 필요 |
| R2_BUCKET_NAME | 모든 PUT/GET/HEAD 대상 | 인증 비밀은 아니지만 인프라 식별정보 |
| R2_ENDPOINT | 기본 endpoint override | 인증 비밀은 아니지만 계정/인프라 노출 |

R2 key는 participant token과 다르다. 브라우저에 key/secret을 보내지 않으며
`NEXT_PUBLIC_*`에 넣지 않는다. URL 서명도 만료 전 사용 가능한 bearer 권한이므로
로그/메신저/분석 도구에 남기지 않는다. 실제 비밀값은 이 문서에 없다.

## S3 호환성과 boto3

S3는 AWS의 객체 저장 서비스/API 계열이다. R2가 그 API의 지원 부분을 구현하기 때문에
Gatheroll은 Python AWS SDK인 **boto3**로 R2를 호출할 수 있다. 저장 대상이 AWS라는 뜻이
아니다. `storage.py`에서 endpoint를 R2로, region을 `auto`, signature를 `s3v4`로 설정한다.
모든 S3 기능이 같다는 가정은 금물이다. 현재 필요한 것은 put/get URL 생성과 HEAD다.

## 승인에서 직접 업로드까지

1. 승인된 participant가 자신의 event token으로 FastAPI에 업로드 초기화를 요청한다.
2. 서버가 이벤트/참여자/한도/타입을 확인하고 pending_upload DB row 및 서버 key를 만든다.
3. boto3가 원본/선택적 썸네일의 PUT URL을 만든다. 기본 900초, type와 길이를 서명한다.
4. `apps/web/features/photos/upload.ts`가 Blob을 R2에 직접 PUT한다. API/Next는 bytes를
   프록시하지 않는다. participant Bearer나 쿠키를 R2로 전달하지 않는다.
5. completion API가 HEAD의 크기/type를 검증하고 DB를 uploaded_private로 확정한다.
6. 자신의 confirmed 목록에 있는 썸네일은 기본 300초짜리 GET URL로 읽는다.

PUT은 쓰기 권한, GET은 읽기 권한이다. 만료가 파일 삭제를 의미하지 않는다. URL을
만드는 것만으로 R2에 파일이 생기지도 않는다. 승인/소유권은 FastAPI의 책임이고,
R2는 서명을 검증한다. HEAD는 실제 이미지 내용/체크섬을 검증하지 않으며 signed PUT은
만료 전 재사용/동일 길이·type 덮어쓰기가 가능하다. ADR 004의 불변성 보완은 아직 미구현.

## Private bucket: stored != public

`r2.dev` public access와 custom public domain은 비활성화하는 구성이다. 이전 설정은
사용자가 대시보드에서 비활성화를 확인했고, 에이전트가 대시보드 전체를 감사한 것은 아니다.
서명 없는 S3 HEAD 거절만으로 모든 공개 도메인이 꺼졌음을 증명할 수는 없다.
업로드는 공유가 아니며 host나 다른 participant도 현재 원본/목록에 접근할 API가 없다.

## CORS와 실제 확인 수준 (2026-09-06)

Origin은 scheme + host + port다. `http://localhost:3000`과
`http://192.168.1.185:3000`은 다르다. 브라우저 frontend origin에서 R2 origin으로
PUT하려면 R2 CORS가 해당 origin/method/header를 허용해야 한다. 서명 URL도 예외가
아니다. 서버 boto3는 브라우저가 아니므로 CORS를 적용받지 않는다.
[Cloudflare CORS 설명](https://developers.cloudflare.com/r2/buckets/cors/).

현재 확인된 사실: 사용자가 개발 CORS에 LAN origin `http://192.168.1.185:3000`을
추가했고 iPhone upload가 동작한다고 보고했다. 이전 localhost 실제 R2 업로드도 확인됐다.
이번 `GetBucketCors` 읽기 요청은 **AccessDenied**라 전체 현행 policy JSON은 독립적으로
조회하지 못했다. object 권한을 넓혀서 문서를 채우지는 않았다.

아래는 기존 설정 가이드에 현재 LAN 주소를 적용한 **의도된 정책 예시**이며 조회된
대시보드 원문이라고 주장하지 않는다. 전체 policy 확정에는 사용자가 대시보드 CORS JSON을
비밀 없이 복사해 주거나 직접 대조해야 한다.

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://192.168.1.185:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

배포 시 실제 HTTPS frontend origin을 명시하고 개발 주소 유지 여부를 검토한다.
아직 배포 origin은 없다. R2 CORS, API `GATHEROLL_WEB_ORIGIN`, Next 개발용
`allowedDevOrigins`는 별개다. Content-Length는 브라우저가 Blob 크기에서 설정하며
JS가 강제로 쓰지 않는다. CORS는 인증 장치가 아니라 브라우저 접근 정책이다.

## 비용을 읽는 법

저장량/보관기간, Class A 쓰기(원본/썸네일 PUT 등), Class B 읽기(GET/HEAD 등)를
본다. signed URL 생성 자체는 로컬 서명이며 PUT 성공이나 GET 열람과 다르다.
현재 공식 설명에서 R2 egress 대역폭 요금은 없지만 저장/요청까지 무조건 무료라는 뜻은
아니다. Infrequent Access는 retrieval 비용/최소 기간 조건도 있다. 가격을 코드에
고정하지 말고 운영 전에 [R2 공식 가격표](https://developers.cloudflare.com/r2/pricing/)를
다시 확인한다(2026-09-06 확인). 지금 월 비용/사용량을 측정했다는 주장은 하지 않는다.

## 실패를 상태로 이해하기

| 실패 | 현재 동작과 한계 |
|---|---|
| DB row만 생기고 PUT 실패 | pending_upload 유지; 같은 client UUID로 재초기화/재시도 |
| PUT 성공 후 completion 응답 실패 | 같은 탭은 성공 PUT checkpoint 유지, complete 재시도; 새로고침 미완료 File 복구는 없음 |
| URL 만료 | 재초기화로 새 URL; 아직 완료 안 된 단계만 재시도 |
| R2 장애 | PUT 실패 또는 HEAD→503; 성공한 다른 사진은 유지 |
| CORS 오류 | 브라우저가 차단; API 정상/서명 유효만으로 성공을 보장 못 함 |
| orphan object/pending row | DB와 R2는 한 트랜잭션이 아님; 자동 정리/보존기간 삭제 아직 없음 |

가장 단순한 대안은 서버 경유 파일 업로드다. 권한 흐름은 한곳에 모이지만 API 메모리,
트래픽, 타임아웃 부담이 늘어난다. 지금 직접 업로드는 그 비용 대신 분리된 실패와
completion 검증 책임을 선택했다. UI의 성공 표시를 곧 DB 확정으로 간주하면 안 된다.

### How I would explain Gatheroll's R2 architecture in 30–60 seconds

Gatheroll은 PostgreSQL에 사진의 소유자와 상태를, 비공개 R2 bucket에 파일을 저장합니다.
승인된 참여자가 업로드를 요청하면 FastAPI가 권한과 한도를 확인해 짧은 PUT URL을
발급하고 브라우저가 원본과 썸네일을 R2로 직접 보냅니다. 완료 요청에서 서버가 HEAD로
크기와 타입을 확인해야 uploaded_private가 됩니다. 조회도 본인 사진에만 짧은 GET URL을
발급하며 업로드와 공유를 분리했습니다. 부분 실패는 성공한 파일/단계를 유지해 재시도합니다.
다만 DB와 객체 저장소는 원자적이지 않아 orphan 정리와 내용 불변성은 다음 검증 과제입니다.
