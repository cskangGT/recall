/**
 * The demo's answers, in Korean and in the memory's own register.
 *
 * seed/answers.json is generated and English, and it reads as a briefing —
 * "You decided…" — which is exactly the voice the product decided against
 * (the memory recalls; it does not report). The hosted demo is the first
 * thing a tester sees, so the scripted answers get a Korean twin here, keyed
 * by the entry's match words, with the same [n] citations so the numbers
 * still resolve. Kept apart from the seed because the seed is generated and
 * this is written.
 */
export const KO_ANSWERS: Record<string, string> = {
  eval:
    'LangChain은 접어두고 Anthropic SDK를 직접 부르기로 했었지 — 추상화 때문에 툴 호출 디버깅이 자꾸 어려워져서 [1]. ' +
    '평가 자체는, 같은 루브릭으로 매겨도 두 리뷰어 점수가 3점씩 벌어진다는 게 남아 있던 입장이었고 [2]. ' +
    '점수 스프레드시트는 Braintrust가 대신하게 됐고, Langfuse는 결국 써보지도 않았잖아 [3].',
  langchain:
    '툴 루프에서 LangChain을 버리고 Anthropic SDK를 직접 쓰기로 했었지 [1]. ' +
    '이유로 적어둔 건 에이전트 추상화 층이 툴 호출 디버깅을 훨씬 어렵게 만든다는 것 [2], ' +
    '그리고 직접 호출하면 스트리밍과 에러 처리가 숨지 않고 드러난다는 것이었어 [3].',
  seed:
    '이 단계 시드 라운드는 포스트 1,500만에 300~500만 사이로 잡히고 있었지 [1], ' +
    '희석 중앙값은 최근 두 분기 내내 20% 언저리였고 [2]. ' +
    '펀드들은 그 라운드로 18~24개월 런웨이를 사길 기대한다고 했잖아 [3].',
  hiring:
    '첫 다섯 엔지니어의 추천에서 지금까지 좋은 채용이 전부 나왔었지 [1], ' +
    '과제 전형은 이미 다른 오퍼를 쥔 후보를 놓치게 하고 [2]. ' +
    '실제 코드로 페어 프로그래밍하는 게 알고리즘 퍼즐보다 성과를 더 잘 예측했었어 [3].',
  pricing:
    '이 단계에선 세 티어보다 유료 티어 하나가 전환이 낫다고 정했었지 [1]. ' +
    '적어둔 근거는, 사용량 과금은 제품을 가장 열심히 퍼뜨리는 파워 유저를 벌준다는 것 [2], ' +
    '그리고 좌석 가격에 닻을 내리면 개인용이 아니라 팀용 소프트웨어처럼 느껴진다는 것이었어 [3].',
  onboarding:
    '5분 안에 첫 항목을 저장한 사용자는 유지율이 두 배였지 [1]. ' +
    '첫 행동 전의 가입 장벽을 걷어내니 활성화가 눈에 띄게 올랐고 [2], ' +
    '이제는 빈 화면이 제품 투어보다 온보딩을 더 많이 해내고 있잖아 [3].',
};
