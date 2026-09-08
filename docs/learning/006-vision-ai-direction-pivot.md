# 006 — 왜 relevance AI를 뺐는가: cleanup-first로 방향 전환

## 인터뷰용 한 문단 (영어 원문 유지)

> We initially built an embedding-based relevance experiment, but realized
> participants already express event intent when they select photos. We
> moved AI toward cleanup, organization, and deduplication, where it removes
> clearer user work.

이 한 문단이 이번 결정의 핵심이다. 아래는 그 배경과 실제 코드에 어떻게
반영됐는지를 한국어로 풀어 쓴 것이다. 전체 결정 기록은
[ADR 007](../adr/007-cleanup-first-ai-direction.md)에 있다.

## 문제 / 결정

ADR 005에서 이미 "호스트가 정한 시작/종료 시간"을 이벤트 멤버십 기준에서
뺐다. 남은 질문은 "그럼 사진 내용(visual embedding)으로 멤버십을 판단할
것인가"였다. 이걸 실제로 설계하고 구현까지 했다 — SigLIP2 임베딩으로
centroid/nearest-neighbor/top-k mean 유사도를 계산해서, 참가자가 고른
후보 사진들 중 "이게 진짜 이 모임 사진인가"를 점수 매기는 실험이다
(`relevance-embeddings` 브랜치, 아직 main에 머지 안 됨).

실제 사진 30~50장을 라벨링하려는 단계에서 다시 생각했다: 참가자가 카메라
롤에서 "이 모임에서 찍은 거 다"를 의도적으로 골라내는 행위 자체가 이미
"이건 이 모임 사진이다"라는 사람의 판단이다. 그 판단을 다시 AI로 재현하려는
건, 이미 사용자가 한 번 한 일을 다시 하는 셈이다. 그 대가로 새로운 ML 런타임
의존성(Python+PyTorch+HuggingFace), 지속적인 라벨링 부담, 그리고 실험
설계 문서 자체가 이미 인정한 실패 모드(한 모임에 여러 장면이 섞이는 경우,
후보가 적을 때의 cold-start)를 떠안는다. 그런데 얻는 이득은 "사용자가 이미
공짜로 준 신호를 다시 추정하는 것"뿐이다. 남는 게 별로 없다고 판단했다.

## 새 방향: relevance는 신뢰하고, AI는 그 다음 단계로

```
참가자가 사진을 고른다
  → 그 선택 자체가 relevance다 (AI 재판단 없음)
  → [새 AI 자리] pre-upload cleanup: 셀피/스크린샷/블러 감지, 사용자가 최종 결정
  → 공유 앨범: multi-label smart filter (People/Selfies/Food/Scenery/Candid)
  → 다운로드: 본인이 올린 사진은 자동 제외
```

AI가 들어가는 자리가 "사용자 의도 재추정"에서 "사용자가 어차피 손으로 할
반복 작업 줄이기"로 옮겨간 것이 핵심이다. 후자가 훨씬 검증하기 쉽고
(스크린샷인지 아닌지는 애매함이 훨씬 적다), 실패해도 피해가 작다(제안만
하고 사용자가 최종 결정).

## `relevance-embeddings` 브랜치에서 뭘 남기고 뭘 버리는가

머지하지 않기로 했지만 지우지도 않는다 — "실험이 없었던 척" 하지 않는다.

**재사용 가능(남김):**
- `eval/embeddings/generate.py`의 캐싱/버저닝 설계 — 파일 content hash로
  이미 임베딩한 사진은 재추론 안 하고, 모델/버전을 artifact에 기록해서
  재현 가능하게 만든 부분. 이건 "로컬 vision embedding을 만들고 재사용하는"
  일반적인 패턴이라 relevance가 아닌 다른 문제(예: 나중에 근사 중복
  탐지)에도 그대로 쓸 수 있다.
- 기존 evaluation 하네스를 건드리지 않고 두 번째 평가 경로를 나란히
  추가한 방식(`reporting.ts`/`cli.ts`) — cleanup 감지기도 결국 자기만의
  평가 경로가 필요할 텐데, "기존 걸 안 건드리고 옆에 추가한다"는 패턴
  자체는 그대로 재사용 가능.

**버림(relevance 전용이라 재사용 안 함):**
- centroid/nearest-neighbor/top-k mean 세 baseline 자체 — "같은 이벤트의
  다른 후보들과 비교"라는 구조 자체가 relevance(=이벤트 멤버십) 문제에만
  의미가 있다. 셀피/스크린샷/블러는 사진 한 장만 보고 판단하는 문제라
  이 비교 구조가 아예 필요 없다.
- self-exclusion, cross-participant support 같은 부기 로직 — 역시 "같은
  이벤트 내 비교"에만 의미 있음.
- `belongs`/`does_not_belong`/`ambiguous` 라벨링 스킴 — cleanup은
  `is_selfie`/`is_screenshot` 같은 훨씬 단순한 사진 단위 이진 라벨이
  필요해서 그대로 못 씀.

## 왜 "삭제"가 아니라 "보존된 히스토리"인가

이전에도 시간/GPS 실험을 이렇게 처리했다(ADR 005, report 004) — 결과를
지우거나 다시 쓰지 않고 "폐기된 가설의 측정 기록"으로 명시적으로 표시했다.
같은 원칙을 여기도 적용한다: 포트폴리오 리포지토리에서 "이 실험을 했고,
왜 접었는지"가 남아 있는 게 "실패를 지우고 성공만 보여주는" 것보다 더
정직하고, 실제로 더 흥미로운 이야기다.
