# Event relevance labeling — v2 (2026-09-07)

참여자의 명시적 broad selection이 첫 relevance filter다. 정답 질문은 “선택된 이 사진이
실제로 함께한 모임의 일부인가?”다. host time window 안/밖이나 GPS 일치로 라벨링하지
않는다. 촬영시각은 보조 metadata이지 ground truth가 아니다. 시간 threshold 추가 튜닝은
하지 않는다. [현재 제품 모델](../product/event-relevance.md).
실제 평가 배치 라벨링은 아직 하지 않았다. 업로드 샘플을 자동 전용하지 않는다.

## 판단 단위와 기준

한 행은 사진 하나와 이벤트 하나의 관계다. 이벤트의 실제 활동/참여 맥락을 기준으로
사람이 판단한다. 시간/GPS가 맞는다는 이유만으로 belongs로 라벨링하지 않는다.
평가기는 이미지 내용을 보지 않지만 라벨러는 사진과 기억/확인된 맥락을 볼 수 있다.
관련성은 공유 동의가 아니다. belongs여도 자동 공유하면 안 된다.

- `belongs`: 모임 활동을 명확히 기록한 사진. 식사만 찍혀도 모임 식사면 포함.
  EXIF가 없어도 맥락이 확실하면 포함. 공식 종료 이후라도 확인된 연속 활동이면 포함.
- `does_not_belong`: 다른 날짜의 같은 장소, 다른 그룹 활동, 무관한 스크린샷,
  저장/다운로드 이미지, 모임 시간 중 찍은 사적인 셀피 등 명확히 무관한 사진.
  파일 형식이나 screenshot 태그 자체가 정답은 아니다. 모임의 일부인지 판단한다.
- `ambiguous`: 규칙과 알려진 맥락으로 사람이 경계를 확정할 수 없는 경우.
  출발/귀가 이동 사진, 종료 직후 같은 그룹의 별도 활동인지 불명확한 사진 등.
  모델 점수가 중간이거나 EXIF가 없다는 뜻이 아니다.

## 수집/라벨링 절차

1. 동의받아 의도적으로 선택한 원본만 로컬 `eval_data/`에 둔다. R2/DB 수집 금지.
2. 모임의 활동/맥락과 후보 배치를 먼저 기록한다. event ID만으로 평가 가능하다.
   날짜/장소는 아는 경우만 맥락으로 기록하고 정확한 시작/종료를 만들어 넣지 않는다.
3. 점수/예측을 보지 않고 각 사진의 label, 짧은 이유, case tags, split을 기록한다.
4. 확신이 없으면 ambiguous + 이유. 가능하면 두 사람이 독립 라벨링하고 불일치를
   기록/합의한다. 바뀐 라벨에는 변경 이유를 남기고 dataset_version을 올린다.
5. burst/같은 모임/원본과 편집본은 같은 split에 둔다. 이벤트 단위 holdout을 우선한다.
   작은 데이터의 development 탐색은 일반화 성능이 아니다. test는 튜닝에 쓰지 않는다.

목표 100–250장은 할당량이 아니다. 실제 수량과 미충족 사례를 보고한다. 수집 체크리스트:
indoor/outdoor, day/night, same_location_different_date/group, before/after,
screenshot, downloaded, unrelated_selfie, food, burst, missing_gps/time,
incorrect_metadata, edited, HEIC/HEIF/JPEG. tags는 사람의 분석용이며 점수 입력이 아니다.

## 개인정보

원본뿐 아니라 GPS/시간/메모/파일명도 개인정보다. 실제 manifest와 결과는 기본적으로
ignored 로컬에 둔다. 공개할 필요가 있으면 별도 검토한 가명 ID/비식별 메모만 version
control한다. 좌표 이동/시간 변경은 평가값을 바꾸므로 공개 합성본과 실제 결과를 구분한다.
공개 CI에는 합성 metadata와 단위 테스트만 사용한다. 원본/실제 결과 artifact 업로드 금지.
