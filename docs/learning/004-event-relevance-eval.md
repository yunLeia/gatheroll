# 004 — 정답을 정의하고 baseline으로 실패를 확인하기

## 2026-09-07 제품 가정 수정

아래 시간/GPS 점수 실험은 **초기 가설의 역사적 기록**이다. host가 정한 시간/장소를
membership의 주요 기준으로 삼는 가정은 폐기했다. 참여자는 이미 camera roll에서
후보 사진을 의도적으로 고르고, 실제 모임은 명확한 시작/끝으로 잘리지 않는다.
따라서 지금 가장 의미 있는 baseline은 **All user-selected photos**다. AI 없이 후보를
모두 관련 있다고 보는 비교군이지 업로드를 즉시 공유하는 구현이 아니다.

정확한 시간은 호스트 필수 정보가 아니며 capture timestamps는 supporting metadata,
ground truth가 아니다. 같은 시간의 스크린샷/사적 셀피가 무관할 수 있고 전후 활동은
관련될 수 있다. 시각/맥락이 주된 미래 가설이고 metadata는 약한 보조 정보다.
아래 지표/회귀 실험은 삭제하지 않지만 추가 시간 튜닝이나 production 필터로 이어가지
않는다. 실제 선택 배치 라벨링 후 all-selected 대비 시각 정보의 가치를 평가할 예정이다.
[현재 설계와 reference audit](../product/event-relevance.md), [ADR 005](../adr/005-event-boundaries-are-not-membership.md).

## 문제와 가장 단순한 대안

Gatheroll에서 위험한 것은 사진을 덜 추천하는 것보다 무관한 사적 사진을 추천하는
것이다. 지금 업로드는 private이며 평가의 selected도 공유 동의가 아니다.
가장 단순한 대안은 전부 사람이 고르는 것이다. 자동화의 가치가 생기는지 보려면
정답 규칙 → 라벨 → 기준선 → 오류 분석의 순서가 필요하다.

Baseline은 비교할 출발점이다. `evaluation/scoring.ts`의 all_selected는 선택한
사진을 전부 이벤트 사진으로 간주한다. 합성 20개에서는 무관한 8개를 모두 선택했다.
이보다 복잡한 시스템이 실제로 나은지 비용/안전/수고를 함께 비교해야 한다.
현재 실제 사진은 0장이다. 아래 수치는 프로그램 동작 검증이지 사용자 성능이 아니다.

## Precision / recall / FP / FN

`reporting.ts`에서 positive는 belongs, 예측 positive는 selected다.

- Precision = TP/(TP+FP): 자동 선택한 확정 라벨 사진 중 정말 이벤트 사진인 비율.
  시간+GPS 합성 결과는 6/(6+4)=60%. 이것은 추천을 신뢰할 수 있는지의 질문이다.
- Recall = TP/(TP+FN): 실제 이벤트 사진 중 자동 선택한 비율. 6/10=60%.
- FP: unrelated → selected. 합성 other_group/selfie는 같은 시간·장소여도 다른 활동이다.
  나중에 공유까지 잘못 연결하면 사생활 위험이라 precision-first다.
- FN: belongs → review 또는 excluded. 합성 4개 중 3개는 review, 1개는 excluded.
  사진 삭제/상실이 아니라 자동 선택의 누락이며 사람이 복구할 여지가 다르다.
- FPR = FP/전체 확정 unrelated: 4/8=50%. Precision과 분모가 다르다.

전부 review로 보내면 FP=0이지만 precision은 분모가 0이라 null이고, recall=0,
review_rate=100%다. 안전해 보이지만 사용자의 일을 줄이지 못한다. 그래서 모든 사진을
분모로 한 review_rate와 automatic_selection_rate도 함께 보고한다.

## 사람이 애매한 것과 모델이 모르는 것은 다르다

`ambiguous`는 모임 이동/종료 경계를 사람이 규칙으로 확정하지 못하는 라벨이다.
EXIF가 없어도 활동이 확실하면 belongs다. 반대로 점수가 1이어도 사람에게 ambiguous일
수 있다. strict 지표에서는 빼고 predicted state별 수량을 별도 보고한다.
이번 합성 ambiguous 2개 중 시간+GPS는 1개 selected/1개 review였다.

## Metadata와 available-signal normalization

`features/photos/metadata.ts`를 브라우저와 CLI가 함께 호출한다. 원본 시각과 명시적
offset만 UTC로 바꾼다. 로컬 PC의 시간대/파일 수정시간을 촬영시각으로 가정하지 않는다.
GPS가 없다는 것은 다른 장소라는 뜻이 아니다. `scoring.ts`는 사용 가능한 가중치로만
나눈다. 시간만 1이면 1/1=1, 시간 1+GPS 0이면 (1+0)/2=0.5다. 둘 다 없으면 null/review.
이 단순성의 대가는 신호 1개의 1점과 신호 2개의 1점을 같은 점수로 취급하는 것이다.
GPS-only 사진이 날짜 없이 선택되는 반례가 있으므로 이 설정을 생산에 쓰면 안 된다.

Haversine은 위도/경도로 구면상의 두 점 사이 대권거리를 미터로 근사한다.
지도 검색/주소 변환이 아니다. 지구 반지름 6,371,000m를 쓰며 적도 경도 1도는 약
111,195m라는 독립 상식값으로 테스트한다. 실내 GPS 오차/다른 층/행사 경계는 해결 못 한다.

## Threshold tuning과 작은 데이터의 함정

점수는 확률이 아니다. `eval/config/v1.json`의 0.9/0.4는 탐색용 시작점이다.
`cli.ts --sweep`는 설정 9개를 모두 보여주고 승자를 자동 채택하지 않는다.
이번 합성 time+GPS에서 select 0.7→0.9→1로 올려도 FP=4는 그대로이고 review는
25%→35%→45%로 늘었다. 관련/무관 사진 모두 1점이면 threshold만으로 분리할 수 없다.
높은 threshold가 항상 precision을 높인다는 보장은 없다.

데이터 leakage는 테스트 결과를 보고 라벨/임계값을 고치거나 같은 burst를 development와
test에 나눠 이미 본 장면으로 성능을 재는 것이다. 과적합은 작은 예제 특성에 맞춰
새 모임에서 통하지 않는 규칙을 만드는 것이다. 이벤트별 split과 dataset/config 버전을
남기고, 적은 자료를 탐색 중이면 그 사실을 보고한다. 지금은 합성 development 한 이벤트뿐이다.

## 다음 질문 — 정말 visual embeddings가 필요한가?

합성 반례는 메타데이터만으로 구분 불가능한 경우가 있음을 보인다. 이것이 실제로 얼마나
자주 발생하고 visual 정보로 구분 가능한지는 아직 모른다. 같은 그룹의 사적 셀피는
시각적으로도 구분하기 어려울 수 있다. 임베딩은 가설이지 해결을 보장하지 않는다.
먼저 동의한 실제 모임 사진을 소량 라벨링해 오류를 확인한다. 그 뒤 시각 단서가 도움이
될 오류군이 반복될 때만 고정 기준선 대비 임베딩 개선을 평가한다. 그때도 공유는 사람 확인이다.

실행법: [eval README](../../eval/README.md). 실제 계산과 전체 제한:
[결과 보고서](../reports/004-metadata-baseline.md).
