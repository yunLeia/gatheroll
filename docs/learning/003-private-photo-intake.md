# Gatheroll 학습 노트 003: 비공개 사진 수집

이번 구현은 **사진 저장의 신뢰성**을 만드는 단계다. 사진의 행사 관련성을
판정하거나 공유 앨범을 만들지 않는다. `uploaded_private`는 AI 승인도 공유
동의도 아니다. 관련 결정은 ADR 004, API 계약과 설정은 testing/003 문서에 있다.

## 1. File, Blob, object URL, R2 객체

`features/photos/intake-panel.tsx`의 `<input type="file" multiple>`에서 사용자가
선택한 항목이 `File`이다. 파일 이름, 타입, 크기와 바이트를 읽을 수 있는
브라우저 객체이지, 서버에 저장된 파일의 주소가 아니다. `File`은 `Blob`의
하위 타입이다. Blob은 이름이 없어도 되는 바이트 덩어리다.

`prepare.ts`의 `canvas.toBlob()`은 원본을 변경하지 않고 작은 JPEG Blob을 만든다.
`URL.createObjectURL(blob)`은 현재 브라우저에서 그 Blob을 표시할 임시 주소를
만든다. `blob:...` 주소를 DB에 넣거나 다른 사람에게 보내도 영구 사진 URL이
되지 않는다. 선택 제거/컴포넌트 해제 시 `revokeObjectURL`로 참조를 해제한다.

R2 객체는 네트워크 저장소의 bucket + key + bytes다. PUT이 실제로 성공해야
생긴다. 서버 DB는 File/object URL을 저장하지 않는다. UI가 사진을 표시한다고
R2 업로드까지 끝났다고 생각하면 안 된다.

가장 단순한 대안은 원본 object URL만 표시하는 것이다. 이번에는 12MP 원본
여러 장을 그리드에 그대로 유지하지 않고 384px 썸네일을 만들어 후속 표시와
전송을 작게 했다. 대신 최초 이미지 디코딩 비용은 피할 수 없다.

## 2. 명시적 선택은 카메라 롤 전체 접근 권한이 아니다

파일 입력은 사용자가 고른 파일만 전달한다. 앱이 나머지 사진 목록을 읽거나
백그라운드로 카메라 롤을 스캔할 권한은 없다. `capture` 강제나 카메라 권한
요청도 추가하지 않았다. iPhone의 사진 선택 UI와 제공 MIME은 실기기에서
확인해야 한다. HTML의 `accept`는 UX 힌트이지 서버 보안 장치가 아니다.

모바일 새로고침/탭 종료/메모리 퇴출은 선택 File, 처리 중 Blob, 큐 상태를
잃게 할 수 있다. 현재는 IndexedDB에 원본을 복제하지 않는다. 완료된 사진은
R2+DB에서 복원하고, 미완료 선택은 다시 골라야 한다. 이것은 살아 있는 탭의
재시도 지원이지, 새로고침을 넘는 바이트 단위 재개 기능이 아니다.

## 3. PostgreSQL과 object storage가 나눠 맡는 일

`models.Photo`는 누가 어느 행사에 올렸는지, 상태, 크기, 타입, 시간, 키를
저장한다. PostgreSQL은 관계·외래 키·유일성·상태 불변식·트랜잭션을 담당한다.
수 MB 원본은 `storage.py`가 서명한 R2 key에 저장한다. 이미지 바이트를 DB에
넣는 것도 기술적으로 가능하지만, 이번에는 DB 백업/연결/쿼리 경로에 큰 파일을
싣지 않고 객체 저장·전송을 R2에 맡긴다. 두 저장소 사이에는 단일 트랜잭션이
없다는 것이 가장 중요한 실패 조건이다.

DB 테이블에는 event_id와 participant_id 외래 키가 있다. 부모 삭제는 기본
NO ACTION이다. DB 행만 cascade 삭제하면 R2 바이트가 남으므로 향후 삭제
서비스는 R2 삭제 성공 후 DB 삭제, 실패 시 재시도를 설계해야 한다.

## 4. Presigned URL은 제한된 임시 열쇠다

`Storage.create_upload_url()`은 서버의 R2 비밀 키로 요청 조건을 서명한다.
브라우저에는 자격증명 원문 대신 특정 bucket/key에 특정 PUT을 할 URL과
Content-Type 헤더만 준다. R2가 서명을 확인하므로 브라우저는 API 비밀 키를
몰라도 업로드할 수 있다. 서명에는 공개 식별자 성격의 access key ID가 포함될
수 있지만 secret access key는 전달되지 않는다.

현재 key, Content-Type, 정확한 Content-Length를 서명한다. 브라우저는 Blob의
길이로 Content-Length를 설정한다. JavaScript가 임의로 그 헤더를 설정하지
않는다. MIME과 크기가 맞아도 실제 JPEG라는 보장은 아니다. 원본 내용 검증은
이번 구현에 없다.

`upload.ts`의 `putObject()`는 바로 R2 URL을 fetch한다. 참가자 Authorization이나
쿠키를 R2로 보내지 않는다. Next.js와 FastAPI는 큰 바이트를 통과시키지 않아
서버 메모리·타임아웃·이중 대역폭 부담을 줄인다. 단순 프록시라는 대안보다
서명/CORS/완료 확인을 더 신중히 설계해야 한다는 절충이 있다.

R2 객체가 비공개인 이유는 bucket의 public access가 꺼져 있고, 객체 읽기에
권한이 필요하기 때문이다. key가 어렵거나 CORS가 있다는 이유가 아니다.
`photos.my_photos()`는 소유자를 확인한 뒤 썸네일 GET만 5분 서명한다. `<img>`를
그대로 사용해 Next 이미지 최적화 서버로도 보내지 않는다.

URL이 유출되면 가진 사람이 만료 전 그 동작을 할 수 있다. PUT은 15분,
GET은 5분 기본값이며 일회용이 아니다. PUT 유출 시 같은 key를 같은 길이/타입의
다른 내용으로 덮을 수 있다. HEAD 완료 검증만으로 불변성이 확보되지 않는다.
향후 AI가 바이트를 신뢰하기 전에 체크섬/불변 최종화 결정을 추가해야 한다.
URL·토큰을 로그, 분석 이벤트, 스크린샷에 넣지 않는 것이 중요하다.

## 5. 실제 요청을 파일/함수로 따라가기

1. `JoinPanel`이 저장된 participant token으로 기존 `participants/me`를 확인한다.
   approved일 때만 `IntakePanel`을 보여준다. 이는 UX이며 최종 보안은 서버다.
2. Add photos → 시스템 파일 선택 → `selectionError`로 서버 제공 제한을 먼저
   확인 → `preparePhoto`가 메타데이터와 가능한 썸네일을 준비한다.
3. **Upload privately** → `uploadBatch` → `photoApi.initialize`가 N개 메타데이터를
   한 JSON 요청으로 보낸다. File 바이트는 이 JSON에 들어가지 않는다.
4. `security.require_participant`는 토큰 해시+행사를 조회하고
   `photos.require_approved`가 승인 상태를 확인한다. 다른 행사 토큰/호스트
   토큰/대기·거절 참가자는 이 경계를 통과하지 못한다.
5. `photos.initialize`는 크기·타입·수량·재시도 일치를 확인하고 participant 행을
   잠근다. 서버 UUID로 Photo+key를 만들고 DB commit 뒤 임시 PUT들을 반환한다.
6. `putObject`가 원본과, 있으면 썸네일을 R2로 보낸다. 동시에 최대 3개 사진
   작업이 돈다. 한 사진의 원본과 썸네일은 순서대로 보낸다.
7. `photos.complete`는 photo id + participant id + event id로 다시 소유권을
   확인하고 사진 행을 잠근다. `verify_object`가 R2 HEAD로 타입/크기를 확인한다.
8. 확인된 사진만 `uploaded_private`, uploaded_at을 기록한다. 클라이언트가
   "업로드 완료"라고 보냈다고 곧바로 믿지 않는다.
9. `my_photos`는 내 완료 사진만 50개씩 반환한다. 타인의 사진과 호스트 권한은
   허용하지 않는다. 새로고침 후에도 저장된 참가자 token이 있으면 조회된다.

클라이언트가 event_id/participant_id/original_key를 임의 입력하는 것은
`PhotoInput(extra="forbid")`가 거부한다. acting participant는 토큰에서,
event는 검증된 참가자의 관계에서, key는 서버가 만든 photo UUID에서 나온다.

## 6. DB pending인데 R2에 바이트가 있을 수 있다

```text
init DB commit → PUT 성공 → complete 응답 유실
```

이는 분산 저장의 정상적인 실패 창이다. 아직 DB commit이 안 됐으면 pending,
commit 뒤 응답만 잃었으면 uploaded_private다. 클라이언트는 추측 대신 같은
photo id로 complete를 다시 요청한다. 완료된 경우 기존 uploaded_at 그대로
돌려주므로 중복 공유나 두 번째 사진 생성이 없다.

init 응답을 잃었을 때도 `client_id`를 그대로 재사용한다. DB의
`(participant_id, client_id)` UNIQUE와 참가자 행 잠금이 중복을 막는다.
같은 client_id로 다른 크기/이름/메타데이터를 보내면 409다. 이는 같은 파일
선택 요청의 멱등성이지 내용 해시 기반 중복 사진 제거가 아니다.

네트워크 오류는 브라우저의 `failed`다. DB에 upload_failed라는 영구 실패
상태를 추가하지 않고 pending을 유지한다. 파일별 성공한 PUT 체크포인트는
메모리에 남아 complete만 실패했을 때 재전송 비용을 줄인다. HEAD가 409로
없음/불일치를 알리면 체크포인트를 버리고 바이트부터 재시도한다. 새 signed
URL은 같은 키에 발급된다. 나머지 성공한 사진은 재시도 목록에서 제외된다.

사용자가 탭을 닫으면 pending이 오래 남을 수 있다. created_at 기준 24시간
이상 pending을 조회하는 SQL과 수동 정리 절차를 testing/003에 기록했다.
현재 자동 정리/정해진 보존기간 삭제는 없다. 이를 "임시니까 자동 삭제된다"고
설명하면 잘못이다. 재시도와 정리의 경합을 막는 정책도 실제 자동화 전에 필요하다.

## 7. 성능: 왜 3개씩, 왜 384px인가

50장을 한 번에 PUT하면 모바일 무선 대역폭과 연결, 업로드 버퍼가 경쟁한다.
성공 응답을 기다리는 요청이 많아져 실패·재시도까지 겹친다. `UPLOAD_CONCURRENCY`
상수 3은 작고 이해 가능한 시작값이다. 이번 구현은 파일 완료 수를 표시하며
정밀 바이트 진행률/XHR/멀티파트 업로드는 추가하지 않았다.

`prepare.ts`는 exifr를 필요할 때 로드하고 원본을 한 장씩 decode한다.
384px 긴 변, JPEG 품질 0.75, 최대 256KiB다. 이미 작은 사진은 확대하지 않는다.
캔버스는 EXIF 없는 새 JPEG를 만들며 원본은 보존한다. HEIC 디코딩 실패 시
썸네일 없이 원본을 저장한다. 40MP 초과가 확인되면 썸네일 생성을 건너뛰지만,
EXIF가 없어 디코딩 전에 크기를 모르면 메모리 할당 자체를 완전히 막지는 못한다.

짧은 작업도 누적될 수 있어 파일 사이에 이벤트 루프를 양보한다. 이것만으로
메인 스레드가 절대 멈추지 않는다고 보장하지 않는다. 현재 합성 PNG 10장의
로컬 처리 시간이 측정되어 있지만 실제 iPhone 사진의 입력 지연과 메모리는
별개다. 실기기에서 스크롤/입력 정지나 긴 작업이 반복 측정되면 그때 Worker와
createImageBitmap/OffscreenCanvas 지원 범위를 검토한다. 복잡도를 장식으로
추가하지 않는다.

미래 AI는 원본 전체보다 작은 썸네일로 시작하면 대역폭/디코딩 비용이 줄 수
있다. 그러나 384px가 모든 모델/문제에 최적이라는 검증은 없으며 지금 AI 호출은
없다. 원본과 thumbnail_key를 분리한 것은 그 검증을 나중에 가능하게 하려는 것이다.

## 8. 현재 메타데이터의 의미와 한계

exifr의 DateTimeOriginal + OffsetTimeOriginal을 함께 얻을 때만 captured_at을
UTC로 정규화한다. offset 없는 카메라 시각을 브라우저 시간대로 해석하지 않는다.
GPS 위경도와 EXIF 크기를 얻으면 기록하고, 실제 디코딩이 가능하면 표시 방향의
naturalWidth/naturalHeight로 크기를 기록한다. 모든 관련 필드는 nullable이다.
파일 lastModified를 촬영 시각으로 대체하지 않는다.

사진 앱에서 EXIF가 제거될 수 있고 사용자가 수정할 수도 있다. `GPS 없음`은
행사 사진이 아니라는 판정이 아니다. 현재값은 검증된 위치 증명이 아니므로
다음 metadata-only baseline에서 누락 처리와 시간대 정책을 따로 평가해야 한다.

## 다음 단계 전에 설명할 수 있어야 할 것

실기기 후속 측정은 `diagnostics.ts`와 `diagnostic-panel.tsx`를 사용한다.
개발 모드에서만 콘솔과 화면에 최근 100개를 표시한다. 숫자/불리언 allowlist로
크기·시간·성공 여부만 기록하며 파일명·좌표·토큰·URL·오류 원문은 버린다.
`tracePhotoStep`은 실패를 기록한 뒤 원래 오류를 다시 던져 재시도 동작을 유지한다.
로그는 원격 분석 서비스가 아니고, 새로고침 시 사라진다. 메모리 사용량이나
메인 스레드 jank를 직접 측정하지 않으므로 준비 시간과 혼동하면 안 된다.

- 미리보기가 보임 / R2에 바이트가 있음 / DB에서 완료임 / 공유됨은 왜 다른가?
- presigned URL은 왜 비밀 키 없이 사용되며, 유출되면 무엇이 가능한가?
- PUT 성공 뒤 DB 완료 실패를 어떻게 복구하는가?
- 같은 client_id와 같은 파일 내용을 중복 제거하는 것은 왜 다른가?
- 새로고침이 복원하는 것은 사진 바이트인가, 참가자와 완료 레코드인가?
- 호스트라고 참가자의 비공개 원본을 볼 수 없는 이유는 무엇인가?
- GPS 누락을 negative label로 처리하면 어떤 제품 오류가 생기는가?

가장 작은 다음 작업은 실기기/R2 인수검증을 마치고, 사용자가 동의한 작은 golden
dataset과 label 기준을 만든 뒤 metadata-only baseline을 평가하는 것이다.
CLIP/임베딩/pgvector는 아직 필요 없다.
