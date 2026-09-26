import { useMemo, useState } from 'react';
import { t, josa, currentLocale, type StringKey, type Locale } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  groupMeetings,
  attendeeLine,
  formatTime,
  formatClock,
  type MeetingGroupKey, isOver, meetingDay, localDay } from '../core/meetings';
import type { MeetingWithContext } from '../core/meetingTypes';
import type { GraphPayload } from '../core/types';
import { MemoryRow } from './Inspector';

/**
 * Meetings — the calendar, read the way Mado reads everything else: not as a
 * grid of hours but as what is ahead and what it remembers about the people
 * in the room. Rows are separated by space, not lines; a row opens on click
 * to show the memories the server attached, each of which is the same row
 * the inspector draws and opens the same page.
 *
 * Before a calendar is connected the page is one sentence and one button —
 * or, on a server with no Google client, one sentence saying so.
 */
const GROUP_LABEL: Record<MeetingGroupKey, StringKey> = {
  today: 'meetings.group.today',
  tomorrow: 'meetings.group.tomorrow',
  week: 'meetings.group.week',
  next: 'meetings.group.next',
  later: 'meetings.group.later',
  past: 'meetings.group.past',
};

export function MeetingsView() {
  const meetings = useWorkspaceStore((s) => s.meetings);
  const source = useWorkspaceStore((s) => s.source);
  const payload = useWorkspaceStore((s) => s.payload);
  const loadMeetings = useWorkspaceStore((s) => s.loadMeetings);
  const openMemoryPage = useUiStore((s) => s.openMemoryPage);
  const locale = currentLocale();

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const groups = useMemo(
    () => (meetings?.connected ? groupMeetings(meetings.meetings, new Date()) : []),
    [meetings],
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const connect = async () => {
    if (!source.connectGoogle || connecting) return;
    setConnecting(true);
    try {
      const { url } = await source.connectGoogle();
      window.location.assign(url);
    } catch {
      useUiStore.getState().toast(t('toast.googleFailed'));
      setConnecting(false);
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadMeetings(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (meetings === null || !meetings.connected) {
    return (
      <div className="meetings meetings--quiet" data-testid="meetings-view">
        <div className="meetings__connect">
          <h2 className="meetings__connect-title">{t('meetings.connect.title')}</h2>
          <p className="meetings__connect-why">{t('meetings.connect.why')}</p>
          {source.connectGoogle ? (
            <button
              className="meetings__connect-cta"
              data-testid="meetings-connect"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {t('meetings.connect.cta')}
            </button>
          ) : (
            <p className="meetings__unconfigured" data-testid="meetings-unconfigured">
              {t('meetings.connect.unconfigured')}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="meetings" data-testid="meetings-view">
      <div className="meetings__page">
        <div className="meetings__head">
          <h2 className="meetings__title">{t('meetings.title')}</h2>
          <span className="meetings__sync">
            {meetings.syncedAt && (
              <span className="meetings__synced" data-testid="meetings-synced">
                {t('meetings.synced', { time: formatClock(meetings.syncedAt, locale) })}
              </span>
            )}
            <button
              className="meetings__refresh"
              data-testid="meetings-refresh"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {t('meetings.refresh')}
            </button>
          </span>
        </div>

        {meetings.reason && (
          <p className="meetings__stale" data-testid="meetings-stale">
            {t('meetings.stale', { reason: meetings.reason })}
          </p>
        )}

        {groups.length === 0 && (
          <p className="meetings__empty" data-testid="meetings-empty">
            {t('meetings.empty')}
          </p>
        )}

        {groups.map((group) => (
          <section
            key={group.key}
            className={`meetings__group meetings__group--${group.key}`}
            data-testid={`meetings-group-${group.key}`}
          >
            <h3 className="meetings__eyebrow">{t(GROUP_LABEL[group.key])}</h3>
            {group.meetings.map((meeting) => (
              <MeetingRow
                key={meeting.id}
                meeting={meeting}
                open={open.has(meeting.id)}
                onToggle={() => toggle(meeting.id)}
                onSelect={openMemoryPage}
                payload={payload}
                locale={locale}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function MeetingRow({
  meeting,
  open,
  onToggle,
  onSelect,
  payload,
  locale,
}: {
  meeting: MeetingWithContext;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  payload: GraphPayload | null;
  locale: Locale;
}) {
  const names = attendeeLine(meeting);
  const link = meeting.meetLink ?? meeting.htmlLink;
  const time = formatTime(meeting, locale);
  const over = isOver(meeting, new Date());
  return (
    <div className={`meeting${over ? ' meeting--over' : ''}`} data-testid={`meeting-${meeting.id}`}>
      <div className="meeting__head">
        <button className="meeting__row" aria-expanded={open} onClick={onToggle}>
          <span className={`meeting__time${meeting.allDay ? ' meeting__time--allday' : ''}`}>
            {meeting.allDay ? t('meetings.allDay') : time}
          </span>
          <span className="meeting__body">
            <span className="meeting__title">{meeting.title}</span>
            {names && (
              <span className="meeting__who" data-testid={`meeting-${meeting.id}-who`}>
                {t('meetings.attendees', { names })}
              </span>
            )}
          </span>
        </button>
        {link && (
          <a
            className="meeting__link"
            href={link}
            target="_blank"
            rel="noreferrer"
            aria-label={t('meetings.open')}
            data-tip={t('meetings.open')}
          >
            ↗
          </a>
        )}
      </div>
      {open && (
        <div className="meeting__context" data-testid={`meeting-${meeting.id}-context`}>
          <span className="meeting__context-eyebrow">{t('meetings.context')}</span>
          {meeting.context.length === 0 ? (
            <span className="meeting__context-none">{t('meetings.context.none')}</span>
          ) : (
            meeting.context.map((c) => {
              const memory = payload?.memories.find((m) => m.id === c.memory_id);
              return memory && payload ? (
                <MemoryRow key={c.memory_id} memory={memory} payload={payload} onSelect={onSelect} />
              ) : (
                // The server remembers something the loaded graph no longer
                // holds — say it anyway, without a page to open.
                <span key={c.memory_id} className="memory-row memory-row--static">
                  <span className="memory-row__text">{c.text}</span>
                  <span className="memory-row__meta">{c.category_name}</span>
                </span>
              );
            })
          )}
          {/* The way back from the calendar into memory: once a meeting has
              begun to happen, there is a line to keep from it. */}
          {(over || meetingDay(meeting) === localDay(new Date())) && <MeetingNote meeting={meeting} />}
        </div>
      )}
    </div>
  );
}

/**
 * One line kept from a meeting.
 *
 * It goes in as an ordinary note, with the meeting and the people written
 * into the original — honestly, as text — so the extractor meets their names
 * and links them. That link is the whole point: the next meeting with the
 * same person finds this memory through the attendee match, with no new
 * table and no meeting id to keep in step.
 */
function MeetingNote({ meeting }: { meeting: MeetingWithContext }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const canCapture = Boolean(useWorkspaceStore((s) => s.source.capture));
  if (!canCapture) return null;

  const save = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    const store = useWorkspaceStore.getState();
    const ui = useUiStore.getState();
    try {
      const names = attendeeLine(meeting);
      const stamp = names
        ? t('meetings.note.stamp', { title: meeting.title, names })
        : t('meetings.note.stampSolo', { title: meeting.title });
      const result = await store.source.capture!({
        type: 'text',
        title: meeting.title,
        content: `${content}\n\n${stamp}`,
      });
      store.applyPayload(result.graph);
      setText('');
      const first = meeting.attendees.find((a) => !a.self)?.name;
      ui.toast(
        first
          ? t('toast.meetingNoted', { name: currentLocale() === 'ko' ? josa(first, '과', '와') : first })
          : t('toast.meetingNotedSolo'),
      );
      // The cards are computed server-side; a fresh read shows the new memory on them.
      void store.loadMeetings();
    } catch {
      ui.toast(t('toast.captureFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meeting__note">
      <input
        className="meeting__note-input"
        data-testid={`meeting-${meeting.id}-note`}
        aria-label={t('meetings.note.placeholder')}
        placeholder={t('meetings.note.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.currentTarget.blur();
            return;
          }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
        }}
      />
      <button
        className="meeting__note-save"
        data-testid={`meeting-${meeting.id}-note-save`}
        disabled={saving || text.trim().length === 0}
        onClick={() => void save()}
      >
        {saving ? t('stage.reading') : t('meetings.note.save')}
      </button>
    </div>
  );
}
