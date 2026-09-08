# 008 — Cleanup v2: selfie 실측, screenshot hybrid, 그리고 "왜 SigLIP2 하나로 다 안 되는가"

배경은 [학습 노트 007](007-cleanup-v1-techniques.md)과
[report 008](../reports/008-cleanup-v2-classifiers-evaluation.md) 참고. 이
노트는 결과 숫자보다 "왜 이렇게 설계했는가"에 집중한다. 전체 아키텍처
제안은 [proposal](../product/cleanup-v2-classifiers-proposal.md)에 있다.

## Zero-shot 분류에서 가장 흔한 실수: "선택지가 모자란다"

Selfie SigLIP2 실험의 첫 결과는 precision 0.35, FPR 0.97 — 사실상 못 쓰는
수준이었다. 원인은 모델이 아니라 **프롬프트 설계**였다.

원래 프롬프트는 3개: `selfie`, `portrait_by_other`, `group_photo`. 셋 다
"누군가의 얼굴이 나온 사진"이라는 전제를 깔고 있다. 그런데 실제 라벨된
49장 중에는 스크린샷도 있고 흐릿한 카메라 사진도 있다 — "얼굴 사진이
아닌" 사진들. Zero-shot classification은 프롬프트 중 **점수가 가장 높은
것 하나**를 무조건 고르는 구조라서, 이 사진들도 3개 중 하나로 강제로
분류된다. 실제로 확인해보니 31개 false positive 전부가 스크린샷(24) 또는
흐릿한 사진(7)이었다 — 진짜 selfie/portrait 혼동이 단 한 건도 없었다.

`selfie_zero_shot.py`에 `screenshot`, `other_no_selfie` 두 카테고리를
추가하고 다시 돌리자 49장 전부 정답. **"모델이 별로다"와 "선택지가
편향됐다"는 완전히 다른 문제이고, 후자를 모델 탓으로 오해하기 매우
쉽다** — 이게 이번 세션에서 가장 값진 교훈이다. Screenshot 쪽도 원래
프롬프트가 `screenshot` vs `camera_photo` 2択이라 이 문제가 덜했던 것뿐,
같은 함정이다.

## Screenshot은 왜 hybrid이고 selfie는 왜 아닌가

두 문제 다 SigLIP2로 잘 풀린다. 그런데 screenshot은 **정말 좋은 2차
신호**가 있다 — 파일 포맷. 진짜 스크린샷은 거의 항상 PNG, 카메라 사진은
거의 항상 JPEG/HEIC. 이건 모델이 아니라 그냥 파일 메타데이터라서 비용이
0에 가깝다. 반면 selfie에는 이만큼 강한 2차 신호가 없다 (얼굴 geometry는
있지만, 이번 실측에서 그 자체가 형편없었다 — face_heuristic 참고).

그래서 원칙은: **신호가 두 개 있고 둘이 서로를 검증할 수 있으면 hybrid,
신호가 하나뿐이면 그 하나를 잘 만든다.** Screenshot hybrid의 핵심 아이디어는
"모델과 메타데이터가 동의하면 확신, 어긋나면 review로 미룬다"는 것 —
`hybridScreenshotDecision`(`screenshot-hybrid.ts`)가 정확히 이 표다:

```
visual=screenshot + format=PNG      → "screenshot" (확신)
visual=camera_photo + format=!PNG   → "camera_photo" (확신)
그 외 (둘이 어긋남)                  → "uncertain" (참가자 판단으로 넘김)
```

실측에서 SigLIP2 혼자 틀린 4장(전부 HEIC 카메라 사진을 스크린샷으로
오판)이 hybrid에서는 정확히 그 4장만 "uncertain"으로 빠진다 — 새로 맞춘
게 아니라, **틀릴 뻔한 걸 "모르겠다"로 정직하게 낮춘 것.** 이게 앙상블
학습이 아니라 해석 가능한 규칙을 쓰는 이유다: 틀린 답을 자신 있게 내는
것보다, 애매하다고 말하는 게 이 제품 철학(`docs/adr/007`: suggest-only,
절대 silent exclude 없음)에 맞다.

## 왜 SigLIP2를 브라우저에서 안 돌리는가

측정해보니: 모델 로드 ~5초(1회성), 이미지 1장 추론 ~200ms(CPU, GPU 없이),
체크포인트 1.4GB. 이건 모바일 브라우저에 넣을 크기가 전혀 아니다 — 이
프로젝트는 이보다 훨씬 가벼운 작업(Web Worker)조차 "측정으로 필요성이
증명되기 전엔 안 넣는다"는 원칙을 지켜왔다. 그래서 서버 사이드,
업로드가 끝난 뒤 비동기로 도는 구조를 제안했다 — 그것도 Redis나 큐
없이, FastAPI `BackgroundTasks`만으로. ~200ms/장이면 사진 20장 배치도
4초 안팎이라, 이 트래픽 규모에서 큐 인프라를 정당화할 근거가 아직
없다.

## HEIC: 이번엔 안 막혔다

프론트엔드(blur 계산, `sharp`/libvips)와 face_heuristic(`cv2.imread`)은
둘 다 진짜 HEIC 파일을 못 읽는다 — 각자 다른 라이브러리의 한계다. 그런데
`pillow_heif.register_heif_opener()`를 쓴 두 SigLIP2 스크립트는 49장 전부
문제없이 읽었다. 같은 "HEIC 문제"처럼 보여도 실제로는 **어느
라이브러리를 쓰느냐의 문제**였다 — 서버 사이드 분류 파이프라인은 이
제약을 애초에 안 물려받는다.
