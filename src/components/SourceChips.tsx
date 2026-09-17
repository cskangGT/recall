import { useRef } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { importFiles } from '../capture/importFiles';
import { importAppleNotesFlow, importNotionFlow, lastSyncOf } from '../capture/batchRun';
import { t } from '../i18n';

/**
 * The ways in from outside: files, this Mac's notes, Notion, and the
 * Instagram door that says honestly it is not open yet.
 *
 * One row, shared by the welcome's last step and home's import link, which
 * is why it carries its own hidden file input — wherever the row is drawn,
 * the picker works, and nothing else has to remember to mount it. The reader
 * chips appear only where the server kept their doors open (the data source
 * drops the methods it cannot serve).
 */
export function SourceChips() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canImportNotes = Boolean(useWorkspaceStore((s) => s.source.importAppleNotes));
  const canImportNotion = Boolean(useWorkspaceStore((s) => s.source.importNotionPages));
  const notesSync = lastSyncOf('notes');

  return (
    <div className="arc__sources" data-testid="fill-sources">
      {/* Each chip blooms a beat after the last — the menu unfolds from the
          link instead of popping in beside it. */}
      <button
        className="arc__source"
        style={{ '--i': 0 } as React.CSSProperties}
        data-testid="source-files"
        onClick={() => inputRef.current?.click()}
      >
        {t('welcome.sourceFiles')}
      </button>
      {/* Named but not yet open: the parser works, the guidance doesn't, and
          a chip that opens a bare file picker loses people. The wizard ships;
          until then the door says so honestly. */}
      <button
        className="arc__source arc__source--soon"
        style={{ '--i': 1 } as React.CSSProperties}
        data-testid="source-instagram"
        aria-disabled="true"
        onClick={() => useUiStore.getState().toast(t('toast.igSoon'))}
      >
        {t('welcome.instagram')}
        <span className="arc__source-soon">{t('welcome.comingSoon')}</span>
      </button>
      {canImportNotes && (
        <button
          className="arc__source"
          style={{ '--i': 2 } as React.CSSProperties}
          data-testid="source-notes"
          title={notesSync ? t('welcome.syncTitle', { date: notesSync.slice(0, 10) }) : undefined}
          onClick={() => void importAppleNotesFlow()}
        >
          {t('welcome.notes')}
          {notesSync && <span className="arc__source-sync">{t('welcome.syncBadge')}</span>}
        </button>
      )}
      {canImportNotion && (
        <button
          className="arc__source"
          style={{ '--i': canImportNotes ? 3 : 2 } as React.CSSProperties}
          data-testid="source-notion"
          onClick={() => void importNotionFlow()}
        >
          {t('welcome.notion')}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        data-testid="door-fill-input"
        accept=".txt,.md,.markdown,.csv,.json,.zip,text/*"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void importFiles(files);
        }}
      />
    </div>
  );
}
