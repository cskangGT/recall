/**
 * Every sentence the product says, in one place, in two languages.
 *
 * The dictionary is the rename too: the product name is a single constant, and
 * the day it changed from Recall to Mado this file is the only place that had
 * to know. Keys are grouped by surface; `t()` interpolates `{name}` params.
 *
 * Locale resolution, in order of authority: `?lang=` (a link someone was sent
 * decides for that visit) → localStorage (the switch in Settings) → the
 * browser's own language → English. Resolved once per load — the app has no
 * live language switcher because every string on screen would have to re-render;
 * Settings writes the choice and reloads.
 */

export type Locale = 'en' | 'ko';

export const PRODUCT = 'Mado';

const STORAGE_KEY = 'mado.lang';

export function resolveLocale(
  search = typeof window === 'undefined' ? '' : window.location.search,
  stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY),
  navigatorLanguage = typeof navigator === 'undefined' ? 'en' : navigator.language,
  timeZone = typeof Intl === 'undefined'
    ? ''
    : (Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''),
): Locale {
  const forced = new URLSearchParams(search).get('lang');
  if (forced === 'ko' || forced === 'en') return forced;
  if (stored === 'ko' || stored === 'en') return stored;
  /*
   * Korean by default only for someone actually in Korea: a Korean-language
   * browser says so directly, and a Seoul clock says so for the expat Mac set
   * to English. Everyone else starts in English — the Settings switch and
   * `?lang=` are one click away either way.
   */
  const inKorea =
    navigatorLanguage.toLowerCase().startsWith('ko') || timeZone === 'Asia/Seoul';
  return inKorea ? 'ko' : 'en';
}

let locale: Locale = resolveLocale();

/*
 * The document must say what language it speaks: a reader announces Korean
 * text with an English voice when the root still claims `lang="en"`, and the
 * `:lang(ko)` stylesheet rules (word-break: keep-all — Korean must not wrap
 * mid-word) hang off the same attribute.
 */
if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
}

export function currentLocale(): Locale {
  return locale;
}

/** Persists the choice and reloads — see the module docstring for why. */
export function chooseLocale(next: Locale): void {
  localStorage.setItem(STORAGE_KEY, next);
  window.location.reload();
}

/** Test hook: set the locale without touching window. */
export function setLocaleForTest(next: Locale): void {
  locale = next;
}

/**
 * The Korean particle that follows a word depends on whether it ends in a
 * final consonant — "지도를" but "기억을". Category names land inside
 * sentences, so the sentences have to get this right or read as broken.
 * Non-Hangul endings (English names, digits) take the vowel form, which is
 * how loanwords are conventionally read aloud.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.charCodeAt(word.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${word}${hasFinal ? withFinal : withoutFinal}`;
}

const en = {
  // ---------------------------------------------------------------- chrome
  'rail.map': 'Map (G)',
  'rail.browse': 'Browse (T)',
  'rail.sources': 'Sources (S)',
  'rail.ask': 'Ask (⌘/)',
  'rail.settings': 'Settings (,)',
  'rail.add': 'Add (⌘K)',
  'rail.views': 'Views',
  'topbar.everything': 'Everything',
  'topbar.bigPicture': 'See the big picture ⇢',
  'tooSmall': `${PRODUCT} is desktop-first. Please open on a larger screen.`,

  // ---------------------------------------------------------------- ticker
  'stage.reading': 'Reading…',
  'stage.extracting': 'Extracting memories…',
  'stage.connecting': 'Finding connections…',
  'stage.reorganizing': 'Reorganizing…',

  // ---------------------------------------------------------------- welcome
  'welcome.title': 'Want to think something through?',
  'welcome.sub':
    '{memories} memories from {sources} sources, already sorted. Ask me anything about them.',
  'welcome.lookAround': 'Look around',
  'welcome.fill': 'Fill your memory',
  'welcome.fillHint': 'Drop files, notes, or an Instagram export — {product} reads and files them',
  'welcome.browse': 'Look around first',
  'welcome.prompt': 'Where would you like to look?',
  'welcome.emptyTitle': 'Nothing up here yet.',
  'welcome.emptyAside':
    `Paste a note, a link, or a screenshot below and ${PRODUCT} will read it and find it a place. The map builds itself from there.`,
  'answer.heading': `What ${PRODUCT} pulled`,

  // ---------------------------------------------------------------- composer
  'composer.placeholder': 'Ask anything, or drop a screenshot to save it…',
  'composer.add': 'Add a note, link, or screenshot',
  'composer.addTitle': 'Add a note, link, or screenshot (⌘K)',
  'composer.ask': 'Ask a question, or paste something to save',
  'composer.send': 'Send',
  'composer.thinking': 'Thinking…',
  'composer.thinkingAria': 'Thinking',
  'composer.askAction': 'Ask',

  // ---------------------------------------------------------------- capture bar
  'capture.title': `Add to ${PRODUCT}`,
  'capture.placeholder': 'Paste text, a link, or an image…',
  'capture.submit': '⏎ to add',
  'type.text': 'Text',
  'type.link': 'Link',
  'type.screenshot': 'Screenshot',

  // ---------------------------------------------------------------- ask bar
  'ask.mode.search': 'Search',
  'ask.mode.ask': 'Ask',
  'ask.placeholder': "Ask across everything you've saved…",
  'ask.placeholderFollowUp': 'Follow up — or start fresh above…',
  'ask.noMatches': 'No matches.',
  'ask.followingUp': 'Following up on “{question}”',
  'ask.startFresh': 'Start fresh',

  // ---------------------------------------------------------------- map
  'map.search.label': 'Search your memories',
  'map.search.placeholder': 'Find something on the map…',
  'map.empty.title': 'Nothing saved yet.',
  'map.empty.sub': `Add a note, a link, or a screenshot and ${PRODUCT} will start building your map.`,
  'map.empty.cta': 'Add your first item',

  // ---------------------------------------------------------------- dropzone
  'drop.hint': `Drop it anywhere — ${PRODUCT} will read it and file it`,

  // ---------------------------------------------------------------- reveal
  'reveal.aria': 'Organizing your saves',
  'reveal.of': 'of',
  'reveal.reading': 'Reading…',
  'reveal.organizing': 'Finding what goes together…',
  'reveal.declare':
    'Organized <b>{memories}</b> memories from <b>{sources}</b> saves into <b>{interests}</b> {interestWord}.',
  'reveal.interest.one': 'interest',
  'reveal.interest.many': 'interests',
  'reveal.skipped.one': '1 thing was already saved — not written twice.',
  'reveal.skipped.many': '{count} things were already saved — not written twice.',
  'reveal.new': 'new',
  'reveal.dismiss': 'Look around',
  'reveal.askPrompt': 'Now ask your memory something:',
  'reveal.suggested': 'What did I save about {name}?',
  'reveal.period': '{from} – {to} — the weeks you almost let slip away, caught.',

  // ---------------------------------------------------------------- banner
  'banner.title': `${PRODUCT} reorganized your map`,
  'banner.undo': 'Undo',
  'banner.gotIt': 'Got it',
  'banner.split': 'Split **{target}** into **{a}** and **{b}**',
  'banner.merge': 'Merged **{a}** and **{b}** into **{result}**',
  'banner.promote': '**{name}** grew into its own category',

  // ---------------------------------------------------------------- reading list / paywall
  'reading.hint.answer': 'Drag any of these up to a category to keep it',
  'reading.hint.folder': 'Drag one up to a category to re-file it',
  'reading.archived.meta': 'Archived · saved {date}',
  'reading.archived.aria': 'Archived memory — upgrade to open',
  'reading.archived.title': 'Past the free window',
  'reading.lock.title': "Moved by you — AI won't change it",
  'paywall.line.one': `${PRODUCT} Free remembers your last {days} days — 1 older memory is archived here.`,
  'paywall.line.many': `${PRODUCT} Free remembers your last {days} days — {count} older memories are archived here.`,
  'paywall.cta': 'Remember everything',

  // ---------------------------------------------------------------- capture story
  'story.progressTitle': 'Reading what you just added',
  'story.title': `What ${PRODUCT} saw`,
  'story.taken.one': '1 memory taken from it',
  'story.taken.many': '{count} memories taken from it',
  'story.echo': 'You already saved something close to this — “{text}” in {category}',
  'story.new': `New to ${PRODUCT}`,
  'story.held': 'You already had this — not saved again',
  'story.filed': 'Filed under',
  'story.restructured': ' — and it reorganized around it',
  'story.nothingNew': 'Nothing new',
  'story.untitled': 'Untitled capture',

  // ---------------------------------------------------------------- inspector
  'inspector.category': 'Category',
  'inspector.memory': 'Memory',
  'inspector.answer': 'Answer',
  'inspector.sources': 'Sources',
  'inspector.workspace': 'Workspace',
  'inspector.legendTitle': 'What you are looking at',
  'inspector.recent': 'Recent changes',
  'inspector.source': 'Source',
  'inspector.extracted': 'Memories extracted from this',
  'inspector.topLevel': 'Top level',
  'inspector.stats': '{memories} memories · {sources} sources · {categories} categories',
  'inspector.categoryMeta': '{path} · {count} memories',
  'inspector.namedLock': "Named by you — AI won't reorganize this",
  'inspector.movedLock': 'Moved by you',
  'inspector.renameTitle': 'Click to rename',
  'inspector.unknown': 'Unknown',
  'inspector.delete': 'Delete',
  'inspector.deleteArmed': 'Delete {label} — click again',
  'inspector.deleteMemoryLabel': 'this memory',
  'inspector.openLink': 'Open link ↗',
  'inspector.sawTitle': `What ${PRODUCT} saw`,
  'inspector.rawTitle': 'Raw content',
  'inspector.emptySource': `${PRODUCT} couldn't find anything to remember in this.`,
  'legend.category': 'Category',
  'legend.categoryNote': 'bigger the more it holds',
  'legend.sub': 'Sub-category',
  'legend.subNote': 'a group inside one',
  'legend.memory': 'Memory',
  'legend.memoryNote': 'one thing you saved',
  'legend.entity': 'Entity',
  'legend.entityNote': 'a name that recurs',

  // ---------------------------------------------------------------- sources
  'sources.title': 'Sources',
  'sources.filter.all': 'All',
  'sources.empty': 'No sources yet.',
  'sources.retry': 'Retry',
  'sources.retrying': 'Retrying…',
  'sources.meta.empty': ' · nothing to remember in this',
  'sources.meta.failed': " · couldn't process this",
  'toast.retryFailed': 'Retry failed.',
  'toast.retryFailedWith': 'Retry failed — {message}',

  // ---------------------------------------------------------------- settings
  'settings.title': 'Settings',
  'settings.esc': 'esc',
  'settings.auto.label': `Let ${PRODUCT} reorganize on its own`,
  'settings.auto.hint':
    'Off means new items still get filed — the structure just stops moving without you.',
  'settings.source.label': 'Data source',
  'settings.source.offline': 'Offline — seeded data, no network',
  'settings.source.goOffline': 'Go offline',
  'settings.language.label': 'Language',
  'settings.language.hint': 'English · 한국어',
  'settings.plan.label': 'Plan',
  'settings.plan.free': `Free — your last {days} days, organized and askable. Older saves are archived, never deleted.`,
  'settings.plan.pro': 'Pro — everything you ever saved, organized and askable.',
  'settings.plan.upgrade': 'Upgrade',
  'settings.reset.label': 'Reset the workspace',
  'settings.reset.hint': 'Back to the {count} seeded memories. Captures and corrections are discarded.',
  'settings.reset.action': 'Reset',

  // ---------------------------------------------------------------- toasts
  'toast.added': 'Added {count} memories.',
  'toast.moved': `Moved. ${PRODUCT} won't change this again.`,
  'toast.reverted': 'Reverted.',
  'toast.deleted': 'Deleted.',
  'toast.workspaceReset': 'Workspace reset.',
  'toast.alreadySaved.one': 'Already saved — nothing new in this one.',
  'toast.alreadySaved.many': 'Already saved — all {count} of these are things you have.',
  'toast.captureFailed': "Couldn't save that.",
  'toast.captureFailedWith': "Couldn't save that — {message}",
  'toast.batchFailed': "Couldn't import those.",
  'toast.batchFailedWith': "Couldn't import those — {message}",
  'toast.batchPartial': "{failed} of {total} couldn't be read — the rest are in.",
  'toast.zipNoneRecent': 'Found {total} saved posts, but none from the last {days} days.',
  'toast.zipOlder.one': 'Imported the last {days} days — 1 older post stayed in the export.',
  'toast.zipOlder.many': 'Imported the last {days} days — {count} older posts stayed in the export.',
  'toast.zipFailed': "Couldn't read that export.",
  'toast.zipFailedWith': "Couldn't read that export — {message}",
  'toast.upgradeSeed': `${PRODUCT} Pro remembers everything. Payments live on the hosted build.`,
  'toast.upgradeFailed': "Couldn't start the upgrade.",
  'toast.upgradeFailedWith': "Couldn't start the upgrade — {message}",
  'toast.upgraded': `${PRODUCT} Pro is on — everything you saved is open.`,
  'toast.archivedTap': `Archived on ${PRODUCT} Free — upgrade to open everything you saved.`,
  'toast.twoLevels': `${PRODUCT} keeps categories two levels deep.`,
  'toast.movedInto': 'Moved {a} into {b}.',
  'toast.retrySeed': 'Retry needs the server — this is seed mode.',
  'toast.nothingReadable': "Couldn't read those files — text, markdown, or a ZIP export work best.",
} as const;

export type StringKey = keyof typeof en;

const ko: Record<StringKey, string> = {
  'rail.map': '지도 (G)',
  'rail.browse': '둘러보기 (T)',
  'rail.sources': '원본 (S)',
  'rail.ask': '질문 (⌘/)',
  'rail.settings': '설정 (,)',
  'rail.add': '추가 (⌘K)',
  'rail.views': '화면',
  'topbar.everything': '전체',
  'topbar.bigPicture': '큰 그림 보기 ⇢',
  'tooSmall': `${PRODUCT}는 데스크톱 우선입니다. 더 큰 화면에서 열어주세요.`,

  'stage.reading': '읽는 중…',
  'stage.extracting': '기억을 꺼내는 중…',
  'stage.connecting': '연결을 찾는 중…',
  'stage.reorganizing': '다시 정리하는 중…',

  'welcome.title': '무언가 정리해보고 싶으신가요?',
  'welcome.sub':
    '{sources}개의 원본에서 나온 {memories}개의 기억이 이미 정리되어 있어요. 무엇이든 물어보세요.',
  'welcome.lookAround': '둘러보기',
  'welcome.fill': '내 기억 채우기',
  'welcome.fillHint': '파일, 메모, Instagram 내보내기를 놓으면 {product}가 읽고 정리해요',
  'welcome.browse': '먼저 둘러볼래요',
  'welcome.prompt': '어디를 들여다볼까요?',
  'welcome.emptyTitle': '아직 아무것도 없어요.',
  'welcome.emptyAside': `아래에 메모, 링크, 스크린샷을 붙여넣으면 ${PRODUCT}가 읽고 자리를 찾아줘요. 지도는 거기서부터 자라나요.`,
  'answer.heading': `${PRODUCT}가 꺼내온 것`,

  'composer.placeholder': '무엇이든 물어보거나, 스크린샷을 끌어다 놓아 저장하세요…',
  'composer.add': '메모, 링크, 스크린샷 추가',
  'composer.addTitle': '메모, 링크, 스크린샷 추가 (⌘K)',
  'composer.ask': '질문하거나 붙여넣어 저장하기',
  'composer.send': '보내기',
  'composer.thinking': '생각 중…',
  'composer.thinkingAria': '생각 중',
  'composer.askAction': '질문',

  'capture.title': `${PRODUCT}에 추가`,
  'capture.placeholder': '텍스트, 링크, 이미지를 붙여넣으세요…',
  'capture.submit': '⏎로 추가',
  'type.text': '텍스트',
  'type.link': '링크',
  'type.screenshot': '스크린샷',

  'ask.mode.search': '검색',
  'ask.mode.ask': '질문',
  'ask.placeholder': '저장해둔 모든 것에 대해 물어보세요…',
  'ask.placeholderFollowUp': '이어서 물어보거나, 위에서 새로 시작하세요…',
  'ask.noMatches': '일치하는 것이 없어요.',
  'ask.followingUp': '“{question}”에 이어서',
  'ask.startFresh': '새로 시작',

  'map.search.label': '기억 검색',
  'map.search.placeholder': '지도에서 찾아보세요…',
  'map.empty.title': '아직 저장된 것이 없어요.',
  'map.empty.sub': `메모, 링크, 스크린샷을 추가하면 ${PRODUCT}가 지도를 만들기 시작해요.`,
  'map.empty.cta': '첫 항목 추가하기',

  'drop.hint': `어디에든 놓으세요 — ${PRODUCT}가 읽고 정리해 드려요`,

  'reveal.aria': '저장한 것을 정리하는 중',
  'reveal.of': '/',
  'reveal.reading': '읽는 중…',
  'reveal.organizing': '무엇이 어울리는지 찾는 중…',
  'reveal.declare':
    '<b>{sources}</b>개의 저장물에서 <b>{memories}</b>개의 기억을 <b>{interests}</b>개의 {interestWord}로 정리했어요.',
  'reveal.interest.one': '관심사',
  'reveal.interest.many': '관심사',
  'reveal.skipped.one': '1개는 이미 저장되어 있어서 두 번 쓰지 않았어요.',
  'reveal.skipped.many': '{count}개는 이미 저장되어 있어서 두 번 쓰지 않았어요.',
  'reveal.new': '새 카테고리',
  'reveal.dismiss': '둘러보기',
  'reveal.askPrompt': '이제 당신의 기억에게 물어보세요:',
  'reveal.suggested': '내가 저장한 {name}, 뭐가 있었지?',
  'reveal.period': '{from} ~ {to} — 잃어버릴 뻔했던 시간의 기억을 붙잡았어요.',

  'banner.title': `${PRODUCT}가 지도를 다시 정리했어요`,
  'banner.undo': '되돌리기',
  'banner.gotIt': '확인',
  'banner.split': '**{target}**를 **{a}**와 **{b}**로 나눴어요',
  'banner.merge': '**{a}**와 **{b}**를 **{result}**로 합쳤어요',
  'banner.promote': '**{name}**가 독립된 카테고리가 됐어요',

  'reading.hint.answer': '위의 카테고리로 끌어다 놓으면 보관돼요',
  'reading.hint.folder': '위의 카테고리로 끌어다 놓으면 옮겨져요',
  'reading.archived.meta': '보관됨 · {date}에 저장',
  'reading.archived.aria': '보관된 기억 — 업그레이드하면 열려요',
  'reading.archived.title': '무료 기간이 지났어요',
  'reading.lock.title': '직접 옮긴 항목 — AI가 바꾸지 않아요',
  'paywall.line.one': `${PRODUCT} 무료는 최근 {days}일을 기억해요 — 더 오래된 기억 1개가 여기 보관되어 있어요.`,
  'paywall.line.many': `${PRODUCT} 무료는 최근 {days}일을 기억해요 — 더 오래된 기억 {count}개가 여기 보관되어 있어요.`,
  'paywall.cta': '전부 기억하기',

  'story.progressTitle': '방금 추가한 것을 읽는 중',
  'story.title': `${PRODUCT}가 본 것`,
  'story.taken.one': '여기서 1개의 기억을 꺼냈어요',
  'story.taken.many': '여기서 {count}개의 기억을 꺼냈어요',
  'story.echo': '비슷한 것을 이미 저장해뒀어요 — {category}의 “{text}”',
  'story.new': `${PRODUCT}에 처음 온 기억`,
  'story.held': '이미 갖고 있어서 다시 저장하지 않았어요',
  'story.filed': '보관 위치:',
  'story.restructured': ' — 그리고 주변이 다시 정리됐어요',
  'story.nothingNew': '새로운 것 없음',
  'story.untitled': '제목 없는 캡처',

  'inspector.category': '카테고리',
  'inspector.memory': '기억',
  'inspector.answer': '답변',
  'inspector.sources': '출처',
  'inspector.workspace': '워크스페이스',
  'inspector.legendTitle': '지금 보고 있는 것',
  'inspector.recent': '최근 변화',
  'inspector.source': '원본',
  'inspector.extracted': '여기서 꺼낸 기억들',
  'inspector.topLevel': '최상위',
  'inspector.stats': '기억 {memories} · 원본 {sources} · 카테고리 {categories}',
  'inspector.categoryMeta': '{path} · 기억 {count}개',
  'inspector.namedLock': '직접 이름 붙임 — AI가 재구성하지 않아요',
  'inspector.movedLock': '직접 옮김',
  'inspector.renameTitle': '클릭해서 이름 바꾸기',
  'inspector.unknown': '알 수 없음',
  'inspector.delete': '삭제',
  'inspector.deleteArmed': '{label} 삭제 — 한 번 더 클릭',
  'inspector.deleteMemoryLabel': '이 기억',
  'inspector.openLink': '링크 열기 ↗',
  'inspector.sawTitle': `${PRODUCT}가 본 것`,
  'inspector.rawTitle': '원문',
  'inspector.emptySource': `${PRODUCT}가 기억할 내용을 찾지 못했어요.`,
  'legend.category': '카테고리',
  'legend.categoryNote': '담긴 게 많을수록 커져요',
  'legend.sub': '하위 카테고리',
  'legend.subNote': '카테고리 안의 묶음',
  'legend.memory': '기억',
  'legend.memoryNote': '저장한 것 하나',
  'legend.entity': '개체',
  'legend.entityNote': '반복해서 나오는 이름',
  'sources.title': '원본',
  'sources.filter.all': '전체',
  'sources.empty': '아직 원본이 없어요.',
  'sources.retry': '다시 시도',
  'sources.retrying': '다시 시도 중…',
  'sources.meta.empty': ' · 기억할 내용이 없었어요',
  'sources.meta.failed': ' · 처리하지 못했어요',
  'toast.retryFailed': '다시 시도하지 못했어요.',
  'toast.retryFailedWith': '다시 시도하지 못했어요 — {message}',

  'settings.title': '설정',
  'settings.esc': 'esc',
  'settings.auto.label': `${PRODUCT}가 스스로 정리하게 두기`,
  'settings.auto.hint': '꺼도 새 항목은 분류돼요 — 구조가 스스로 움직이지 않을 뿐이에요.',
  'settings.source.label': '데이터 소스',
  'settings.source.offline': '오프라인 — 시드 데이터, 네트워크 없음',
  'settings.source.goOffline': '오프라인으로',
  'settings.language.label': '언어',
  'settings.language.hint': 'English · 한국어',
  'settings.plan.label': '플랜',
  'settings.plan.free': `무료 — 최근 {days}일이 정리되고 질문 가능해요. 오래된 저장물은 삭제가 아니라 보관돼요.`,
  'settings.plan.pro': 'Pro — 저장한 모든 것이 정리되고 질문 가능해요.',
  'settings.plan.upgrade': '업그레이드',
  'settings.reset.label': '워크스페이스 초기화',
  'settings.reset.hint': '시드 기억 {count}개로 되돌아가요. 캡처와 수정 내역은 사라져요.',
  'settings.reset.action': '초기화',

  'toast.added': '기억 {count}개를 추가했어요.',
  'toast.moved': `옮겼어요. ${PRODUCT}가 다시 바꾸지 않아요.`,
  'toast.reverted': '되돌렸어요.',
  'toast.deleted': '삭제했어요.',
  'toast.workspaceReset': '워크스페이스를 초기화했어요.',
  'toast.alreadySaved.one': '이미 저장되어 있어요 — 새로운 내용이 없어요.',
  'toast.alreadySaved.many': '이미 저장되어 있어요 — {count}개 모두 갖고 있는 것들이에요.',
  'toast.captureFailed': '저장하지 못했어요.',
  'toast.captureFailedWith': '저장하지 못했어요 — {message}',
  'toast.batchFailed': '가져오지 못했어요.',
  'toast.batchFailedWith': '가져오지 못했어요 — {message}',
  'toast.batchPartial': '{total}개 중 {failed}개를 읽지 못했어요 — 나머지는 들어갔어요.',
  'toast.zipNoneRecent': '저장된 게시물 {total}개를 찾았지만, 최근 {days}일 안의 것이 없어요.',
  'toast.zipOlder.one': '최근 {days}일을 가져왔어요 — 더 오래된 게시물 1개는 내보내기에 남아 있어요.',
  'toast.zipOlder.many': '최근 {days}일을 가져왔어요 — 더 오래된 게시물 {count}개는 내보내기에 남아 있어요.',
  'toast.zipFailed': '내보내기 파일을 읽지 못했어요.',
  'toast.zipFailedWith': '내보내기 파일을 읽지 못했어요 — {message}',
  'toast.upgradeSeed': `${PRODUCT} Pro는 모든 것을 기억해요. 결제는 호스팅 버전에서 열려요.`,
  'toast.upgradeFailed': '업그레이드를 시작하지 못했어요.',
  'toast.upgradeFailedWith': '업그레이드를 시작하지 못했어요 — {message}',
  'toast.upgraded': `${PRODUCT} Pro가 켜졌어요 — 저장한 모든 것이 열렸어요.`,
  'toast.archivedTap': `${PRODUCT} 무료에서는 보관함이에요 — 업그레이드하면 전부 열려요.`,
  'toast.twoLevels': `${PRODUCT}는 카테고리를 두 단계까지만 둬요.`,
  'toast.movedInto': '{a}를 {b}로 옮겼어요.',
  'toast.retrySeed': '다시 시도는 서버가 필요해요 — 지금은 시드 모드예요.',
  'toast.nothingReadable': '읽을 수 있는 파일이 없어요 — 텍스트, 마크다운, ZIP 내보내기가 가장 잘 돼요.',
};

const STRINGS: Record<Locale, Record<StringKey, string>> = { en, ko };

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let out: string = STRINGS[locale][key] ?? en[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}
