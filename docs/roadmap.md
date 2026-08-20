# Mado 로드맵

> 설계도 묶음: 제품 규칙은 [product-spec.md](product-spec.md), 기억의 원칙은 [memory-charter.md](memory-charter.md),
> 여기는 **무엇을 언제 만들지**. 갱신일: 2026-08-20.

## 지금까지 (배포됨 — http://43.202.24.252, Lightsail 서울)

- **코어**: 3면(둘러보기·지도·원본) · 기하학 게이트 자동 재구성 · 인용 Ask(스트리밍, '기억 자신' 회상체) · 대화 스레드 · 키워드 렌즈 드릴다운 · 유사 기억 합치기(AI 이유 + 무손실)
- **검수 (spec §21)**: 원문↔기억 대조, 유지/빼기/고치기, 모든 평결이 curation 신호로 기록 → 최근 discard가 다음 추출의 부정 예시 (학습 루프 v1)
- **임포트**: 파일 드롭 · Instagram export ZIP(실물 스키마) · Apple Notes · Notion(원천 URL 보존, "원천에서 지워도 안전" 배지)
- **비즈니스**: 2주 무료 창 페이월 · Stripe 테스트 결제 왕복(free→pro 검증) · 초대 토큰 게이트 · 방문자별 워크스페이스 · 로케일별 시드(en 47 / ko 59, 둘 다 실파이프라인으로 저작)
- **i18n**: en/ko 사전 단일화, ko 명명 하드 룰
- **일기**: 하루 단위의 방 (D) — 달력 + 하루 페이지(쓰기·이어쓰기) + 그날 들어온 기억 자동 표시. 일기도 파이프라인을 타서 지도·검색·Ask에 합류. 회고("그때의 나 요약")는 다음 단계

## 다음 (우선순위순)

1. **도메인 + HTTPS** — mado.io/so 등록(유저 액션) → DNS·인증서 → 테스터 링크 교체. *지금 유일하게 막힌 것.*
2. **Stripe 웹훅 실서버 등록** — 대시보드에 호스팅 엔드포인트 추가(도메인 후) → 실서버 결제 왕복
3. **인스타 내보내기 마법사** — 유저 플로우 합의 완료(신청 안내→JSON 강제→대기 배너→드롭). 온보딩 이탈 방지의 핵심
4. **모바일 공유 타깃 (PWA)** — 인스타/어디서든 "공유→Mado". 과거는 ZIP, 앞으로는 공유 = 체감 연동
5. **주간 타임라인 뷰** — 원본 뷰 진화: 주 단위 그룹 + 이 주의 키워드 칩(keywordsFor 재사용). 페이월·다이제스트와 문법 연결
6. **2주 다이제스트** — 재방문 루프. 타임라인 위에 얹음

## AI 트랙 (ML 엔지니어용 — 상세는 멀티모달 매핑 문서)

원칙: 상황이 모델을 고른다 · 한국어 1급 시민 · 로컬-퍼스트 · 임베딩 공간은 하나.

- **Phase 1 텍스트 품질 (지금)**: **시맨틱 검색** — 지도·커맨드바 검색이 서버의 하이브리드 검색(FTS+벡터 융합, Ask가 쓰는 것)을 타게 노출. 현재 검색 UI는 키워드 매칭뿐이라 "빵 굽기"로 "사워도우"를 못 찾는다 → 임베딩 ko 벤치마크(voyage-3.5 vs text-embedding-3-small vs bge-m3) → reranker 도입(검색·관련성 공용) → 모델 티어 분리(추출=Haiku급, 명명·Ask=Sonnet급)
- **Phase 2 이미지**: Apple Vision OCR 로컬 게이트 → VLM scene_description → IG 썸네일 이해
- **Phase 3 음성·영상**: 온디바이스 STT(whisper.cpp) → 릴스(Gemini 평가)
- **Phase 4 온디바이스 티어 + MCP**: 로컬 모델 스택(Qwen3-4B/bge-m3), AI 대화 로그 수집
- **검수 신호 확장**: v2 discard 용어의 키워드 렌즈 가중 ↓ / edit 표현 가중 ↑ → v3 워크스페이스 취향 프로파일(카테고리 입도·명명)
- 각 Phase 산출물: ko 포함 벤치마크 + 기능당 원가($/1,000 기억) + 게이트웨이 미터링 단위

### 저비용·로컬 대안 표 (검토 대상 — 벤치마크로 판정)

| Task | Current | Alternatives | Mado 메모 | Ref |
|---|---|---|---|---|
| Read screenshots | gpt-4.1 | PaddleOCR | Apple Vision(맥 온디바이스)과 비교 필요; PaddleOCR은 서버측 후보 | [1] |
| Extract memories | gpt-4.1 | Small LLM + rules | 검수 신호 few-shot과 결합 시 소형 모델 품질 상승 여지 | [2] |
| Embed text | voyage / text-embedding-3-small | text-embedding-3-small or local MiniLM (all-MiniLM-L6-v2) | ⚠ MiniLM-L6은 영어 중심 — ko는 bge-m3가 로컬 후보 | [3] |
| Name categories | gpt-4.1 / claude-opus-5 | KeyBERT / RAKE / YAKE | 이미 TF-IDF 폴백(nameTokens) 구현됨 — 같은 계열, ko 조사 처리 포함 | [4] |
| Answer questions | gpt-4.1 / claude-opus-5 | Small LLM or extractive answer | 인용 계약(검증된 [n]만) 유지가 전제 — extractive는 거부율 상승 예상 | [5] |

**Ref**
[1] Li et al. (2022), PP-OCRv3, arXiv. · [2] Busta & Oyler (2025), small language models for structured extraction, Quantitative Plant Biology. · [3] Pavlyshenko & Stasiuk (2025), transformer sentence embeddings, Electronics and Information Technologies. · [4] Nadim, Akopian & Matamoros (2023), unsupervised keyword extraction tools, IEEE Access. · [5] Qian et al. (2025), VeriCite for citation-aware RAG, ACM SIGIR Asia Pacific.

## 장기 베팅

- **Meta TYI(정보 전송) 목적지 등록** — 성사 시 인스타 "진짜 연동". 파트너 심사 필요, 요건 조사부터
- **노션 정리본 내보내기** — 필요 시 POST /v1/pages (부모 페이지 연결 전제)
- **MCP 서버** — 에이전트들의 기억 계층

## 원칙 리마인드 (결정된 것, 흔들지 않기)

- 답변 페르소나는 **기억 자신** (회상체) · 질문과 저장은 **다른 표면** · placeholder는 …로 끝내지 않음
- Mado는 남의 원본을 절대 지우거나 고치지 않는다 — 표시와 링크까지, 삭제는 유저의 손
- 검수는 제안이지 숙제가 아니다 — 지도는 검수 없이도 완성돼 있다
