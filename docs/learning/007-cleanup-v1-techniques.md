# 007 — Pre-upload Cleanup v1: 왜 이 기법들을 골랐는가

배경은 [학습 노트 006](006-vision-ai-direction-pivot.md)과
[ADR 007](../adr/007-cleanup-first-ai-direction.md) 참고. 이 노트는 cleanup v1의
4개 신호(blur/screenshot/selfie/duplicate) 각각을 왜 이 기법으로 골랐는지,
실제 코드에 연결해서 설명한다. 실측 근거는
[report 006](../reports/006-cleanup-v1-smoke-evidence.md)에 있다.

## 왜 4개가 서로 완전히 다른 기법을 쓰는가

"AI 정리 기능"이라고 뭉뚱그리면 하나의 모델(예: SigLIP2)을 4개 문제에 다
갖다 붙이고 싶어진다. 그런데 4개는 실제로 완전히 다른 종류의 문제다:

- **blur**: 픽셀 통계 문제 (가장자리가 얼마나 있나) — 모델 필요 없음.
- **screenshot**: 메타데이터 분류 문제 (파일 형식/해상도/EXIF 유무) — 이것도
  모델 필요 없음, 사진 "내용"을 볼 필요가 아예 없다.
- **selfie**: 진짜 vision 이해가 필요한 문제 (누가 카메라를 들고 있었나) —
  여기만 모델 후보가 정당하다.
- **duplicate**: 정확히 같은 바이트인가 — 이건 판단이 아니라 사실 확인이라
  애초에 "정확도"라는 개념 자체가 없다.

`docs/product/pre-upload-cleanup-v1-proposal.md`의 원칙("Prefer the simplest
technique per task; do not force one model onto everything")을 실제로
지켰는지는, 4개 중 3개가 모델을 아예 안 쓴다는 사실로 확인된다
(`apps/web/features/cleanup/blur.ts`, `screenshot.ts`, `duplicates.ts` 전부
순수 함수, import된 모델 없음).

## Blur: Laplacian variance

`computeBlurScore`(`blur.ts`)는 흑백 변환 + Laplacian 커널(4-이웃 미분) +
분산 계산이다. 이유: 흐린 사진은 가장자리가 적어서 미분 응답의 분산이
작다. 수십 년 된 검증된 기법이라 라벨 없이도 함수 자체는 바로 테스트 가능
(`solid()`/`checkerboard()` 합성 픽셀로 8개 케이스 검증). "얼마나 흐려야
possibly_blurry인가"는 `blur_threshold` 하나로 분리해뒀다 — 실제 데이터로
sweep해서 정할 값이라 지금은 placeholder(100)다.

## Screenshot: 메타데이터 휴리스틱

`isLikelyScreenshot`은 "PNG 형식 + 알려진 기기 화면 해상도 (+ 선택적으로
카메라 EXIF 없음)"만 본다. 스크린샷을 vision 모델로 판단하는 건 낭비다 —
스크린샷과 카메라 사진은 내용이 아니라 **만들어진 방식** 자체가 다르고,
그 차이가 파일 메타데이터에 이미 다 있다. `metadata.ts`의
`has_camera_exif`도 새 파싱 없이 기존 exifr 추출 결과 재사용(어떤 필드든
하나라도 있으면 true) — "같은 패스에서 재사용, 두 번 파싱하지 않는다"는
기존 코드베이스 원칙 그대로.

## Selfie: 왜 "비교 실험"으로 시작했는가

여기가 이 단계 전체에서 가장 중요한 설계 결정이다. 처음 초안은
"얼굴이 있고 크고 중앙에 있으면 셀피"를 그냥 production 규칙으로 넣으려고
했다. 그런데 이 규칙은 인물사진(다른 사람이 찍어준)과 그룹사진에서 거의
확실히 헷갈린다 — 실제로 `face_heuristic.py`를 실사진 한 장에 돌려보니
Haar Cascade 기본 파라미터가 작은 오탐지 "얼굴"을 10개나 찾았고, 그 중
가장 큰 것도 전체 이미지의 0.12%밖에 안 됐다(report 006). 이게 "간단한
baseline이 실제로 얼마나 부정확할 수 있는가"를 코드 없이 말로만 예측하는
대신 **실제로 돌려서 확인한** 사례다.

그래서 production 규칙을 정하는 대신, 두 pretrained 기법(얼굴 기하학
휴리스틱 vs. SigLIP2 zero-shot)을 나란히 비교하는 것 자체를 산출물로
삼았다. `cleanup-selfie-compare.ts`의 `faceHeuristicDecision`은 지금도
threshold를 받는 함수지, 고정된 값이 아니다 — 실측 없이 "이 정도면
되겠지"로 값을 박아넣지 않겠다는 뜻이다.

### 인터뷰용 문단 (영어)

> We evaluate selfie detection as a comparison between a cheap geometric
> heuristic and a pretrained vision-language model instead of assuming
> which is right. The heuristic alone would likely confuse portraits and
> group photos with selfies — we don't ship it as the production classifier
> until we've measured whether the extra weight of a vision-language model
> actually buys enough accuracy to justify it.

## Duplicate: 왜 "평가"가 없는가

SHA-256은 확률적 판단이 아니라 사실 확인이다. 두 파일이 같은 해시면 같은
바이트다, 끝. 그래서 `groupExactDuplicates`엔 threshold도, config도,
precision/recall도 없다 — 없는 게 맞다. `docs/eval/003-cleanup-v1-experiments.md`에도
"Data needed: none"이라고 명시했다. 대신 실제 로컬 사진 169장을 스캔해서
중복 0개를 확인했는데(report 006), 이건 "평가"가 아니라 그냥 사실 하나를
측정한 것 — 개인 카메라롤 내보내기라 그런지 정확히 겹치는 파일은 없었다는
의미다.

**Near-duplicate**(리사이즈/편집/재압축된 "거의 같은" 사진)는 완전히 다른
문제라 이번엔 손대지 않았다 — pHash나 embedding 유사도가 필요하고, 그건
정확도 개념이 다시 생기는 문제라서 exact-duplicate와 같은 함수에 섞으면 안
된다.

## Blur/screenshot/duplicate의 공통점

셋 다 "브라우저에서 계산해서 `PhotoJob`에 노출만 하고, 리뷰 UI는 아직 안
만든다"는 같은 경계를 지킨다(`prepare.ts`). 데이터는 이미 있는데 그걸
사용자에게 어떻게 보여줄지는 다음 단계 — 지금 이 슬라이스의 목적은
"측정 가능한 신호를 만드는 것"이지 "완성된 정리 기능"이 아니다.

## 2026-09-08 추가: 실측 결과로 확인된 것들

실제 49장 라벨 세트(`eval_data/cleanup-manifest.json`)로 돌려본 결과, 위에서
"구조적으로 fragile하다"고 추론만 했던 것들이 실제 숫자로 확인됐다. 전체
숫자는 [report 007](../reports/007-cleanup-v1-real-evaluation.md) 참고.

**Screenshot 메타데이터 휴리스틱은 실제로 완전히 실패했다.** recall 0%
(24개 실제 스크린샷 중 0개 탐지). 원인: `content_type`은 정확히
`image/png`로 잡혔는데(형식 체크는 작동함), 실제 해상도가 **1206×2622**로
`known_dimensions` 8개 목록 어디에도 없었다. 이게 위에서 말한 "9번째
항목을 추가하는 건 해결이 아니다"라는 예측이 말로만 그친 게 아니라, 실제
기기 하나로 바로 증명된 사례다 — 리스트에 값을 계속 추가해도 다음 기종이
나오면 또 깨진다.

그래서 대신 SigLIP2 zero-shot(`screenshot_zero_shot.py`, 프롬프트
2개: "스크린샷" vs. "카메라로 찍은 사진")으로 바꿔봤더니 recall 100%,
precision 85.7%였다. 이게 selfie 챕터에서 설명한 것과 같은 이유다 —
스크린샷 여부는 사실 "내용 기반" 문제(화면 UI처럼 생겼나)인데, 해상도
목록은 "열거 기반" 접근이라 애초에 문제의 모양과 안 맞았다. SigLIP2는
새 기기 해상도가 나와도 깨지지 않는다 — 목록에 없는 값을 찾는 게 아니라
이미지가 실제로 어떻게 생겼는지를 보기 때문이다.

**HEIC 발견은 별개의, AI 방향성과 무관한 환경/툴링 이슈다.** `sharp`가
실제 라벨된 HEIC 파일 15개 전부에서 똑같은 에러(`heif: Decoder plugin
generated an error`)로 디코딩에 실패했다 — 코덱 플러그인이 이 환경에
없거나 깨진 것이지, blur 알고리즘 자체의 문제가 아니다. `computeBlurScore`
는 건드리지 않고, 평가 전용으로만 macOS `sips`를 이용해 HEIC를 JPEG로
변환해 캐싱하는 다리 하나만 추가했다 — 원본 HEIC 파일은 그대로 둔다. 이
수정 후 15/15 전부 복구됐고, blur 지표가 그제서야 49장 전체를 대상으로
측정됐다(이전엔 34/49만 채점되고 나머지는 조용히 제외되고 있었다).
