import { useUiStore, STAGE_LABEL, type CaptureStage } from '../store/uiStore';
import { t } from '../i18n';

/**
 * The account of what just happened to something you dropped in.
 *
 * Two states, same surface. While the pipeline runs it names the four stages;
 * when it finishes it answers the questions the ticker never did — what Recall
 * actually read, whether each piece is new or an echo of something already
 * saved, and which top-level category it landed in.
 *
 * That middle question is the one that matters. "You already saved something
 * close to this" is the moment the product stops looking like a filing cabinet
 * and starts looking like a memory.
 */

const STAGES: Exclude<CaptureStage, 'idle'>[] = [
  'reading',
  'extracting',
  'connecting',
  'reorganizing',
];

export function CaptureStoryPanel() {
  const stage = useUiStore((s) => s.captureStage);
  const story = useUiStore((s) => s.lastCapture);
  const setLastCapture = useUiStore((s) => s.setLastCapture);

  if (stage !== 'idle') {
    const current = STAGES.indexOf(stage);
    return (
      <div className="capture-story" data-testid="classify-panel">
        <div className="capture-story__title">{t('story.progressTitle')}</div>
        <ol className="capture-story__steps">
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={`capture-story__step${
                i < current
                  ? ' capture-story__step--done'
                  : i === current
                    ? ' capture-story__step--now'
                    : ''
              }`}
            >
              <span className="capture-story__dot" />
              {STAGE_LABEL[s]}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (!story) return null;

  return (
    <div className="capture-story capture-story--result" data-testid="capture-story">
      <div className="capture-story__head">
        <span className="capture-story__title">{t('story.title')}</span>
        <button
          className="capture-story__close"
          data-testid="capture-story-close"
          onClick={() => setLastCapture(null)}
        >
          esc
        </button>
      </div>

      <p className="capture-story__saw">{story.saw}</p>

      <div className="capture-story__label">
        {story.memories.length === 1
          ? t('story.taken.one')
          : t('story.taken.many', { count: story.memories.length })}
      </div>

      {story.memories.map((memory) => (
        <div key={memory.id} className="capture-story__memory" data-testid="capture-story-memory">
          <span className="capture-story__text">{memory.text}</span>
          {memory.echoOf ? (
            <span className="capture-story__echo" data-testid="capture-story-echo">
              {t('story.echo', { text: memory.echoOf.text, category: memory.echoOf.categoryName })}
            </span>
          ) : (
            <span className="capture-story__new" data-testid="capture-story-new">
              {t('story.new')}
            </span>
          )}
        </div>
      ))}

      {/*
        What was read and deliberately not kept.
        A source that produced four memories and added one has to say why, or
        the count reads as extraction having failed.
      */}
      {story.alreadyHeld.map((held, i) => (
        <div key={i} className="capture-story__memory" data-testid="capture-story-held">
          <span className="capture-story__text">{held.text}</span>
          <span className="capture-story__echo">{t('story.held')}</span>
        </div>
      ))}

      {story.destination && (
        <div className="capture-story__dest" data-testid="capture-story-destination">
          {t('story.filed')} <strong>{story.destination}</strong>
          {story.restructured && t('story.restructured')}
        </div>
      )}
    </div>
  );
}
