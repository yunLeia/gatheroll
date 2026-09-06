# Codex 설정과 프로젝트 기억

2026-09-06, codex-cli 0.153.4에서 확인.

사용자 전역 `~/.codex/config.toml`의 기존 [features] 아래에 적용:

```toml
context_management = { experimental_mode = true }
```

이는 `features.context_management.experimental_mode = true`와 같은 구조다.
CLI `codex features list`에서 context_management=true를 확인했다.
실험 기능이고 활성 요청에 소급 적용됐다는 보장은 없다. 새 작업에서 사용한다.
공식 문서는 노트와 검색 가능한 이력 기반의 context 관리이며 ChatGPT
Plus/Pro/Pro Lite 로그인이 필요하다고 설명한다. 토큰 절약 수치는 측정하지 않았다.

`model_auto_compact_token_limit`과 `model_context_window`는 임의로 설정하지 않았다.
자동 압축 임계값은 미설정 시 모델 기본값을 사용한다. 너무 잦은 압축이 무조건
저렴하거나 정확한 것은 아니다. 모델/추론 수준은 현재 사용자 선택을 유지한다.

## 기억 복원 순서
1. AGENTS.md: 짧은 작업 규칙과 제품 원칙
2. docs/STATUS.md: 현재 구현/검증/다음 작업
3. 해당 작업의 spec, ADR, 학습 노트
4. 필요한 경우만 docs/product/original-brief.md 원문

대화가 길어지거나 새 작업으로 옮겨도 이 파일들을 읽어 복원한다. 자동 기억은
완벽한 보존을 보장하지 않으므로 승인된 제품 원문과 결정은 Git에서 관리한다.
학습 내용은 docs/learning에 실제 파일과 함께 남기고, 미래 기능은 완료로 쓰지 않는다.

새 작업 시작 예시: “AGENTS.md와 docs/STATUS.md를 읽고, 다음 승인된 작은
기능을 구현해줘. 결정과 학습 노트를 업데이트하고 실제 검증 결과를 남겨줘.”

공식 근거: https://learn.chatgpt.com/docs/config-file/config-reference
되돌리기: 위 context_management 항목을 제거하거나 experimental_mode=false로 변경.
전역 설정에는 개인 연결 정보가 있을 수 있으므로 저장소에 복사하지 않는다.
