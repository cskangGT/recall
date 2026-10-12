import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildTree } from '../tree/buildTree';
import type { Memory } from '../core/types';

/**
 * The folder view — the desktop-window grammar, forty years old and learned
 * by nobody (2번). Categories are folders in a window, memories are files;
 * double-click walks in, the path walks back, and dragging a file onto a
 * folder re-files it through the same store action every other surface uses.
 *
 * It lives inside Sources because that is the drawer: the ledger list answers
 * "what came in", this answers "where everything is", and the toggle between
 * them is a taste, remembered.
 */

export function FolderView() {
  const payload = useWorkspaceStore((s) => s.payload);
  const select = useUiStore((s) => s.select);
  const selectedId = useUiStore((s) => s.selectedId);
  const moveMemory = useWorkspaceStore((s) => s.moveMemory);

  const [folderId, setFolderId] = useState<string | null>(null);
  const [dragMemoryId, setDragMemoryId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);

  const rows = useMemo(() => (payload ? buildTree(payload) : []), [payload]);
  if (!payload) return null;

  const categoryRows = rows.filter((r) => r.kind !== 'memory');
  const here = folderId ? categoryRows.find((r) => r.id === folderId) : undefined;

  // The trail back: 전체 > parent > child. Clicking any crumb jumps there.
  const trail: { id: string | null; label: string }[] = [{ id: null, label: t('folders.root') }];
  if (here?.parentId) {
    const parent = categoryRows.find((r) => r.id === here.parentId);
    if (parent) trail.push({ id: parent.id, label: parent.label });
  }
  if (here) trail.push({ id: here.id, label: here.label });

  const folders = categoryRows.filter((r) =>
    folderId === null ? r.depth === 0 : r.parentId === folderId,
  );
  const files: Memory[] =
    folderId === null ? [] : payload.memories.filter((m) => m.category_id === folderId);

  const enter = (id: string) => {
    setFolderId(id);
    select(id);
  };

  const fileDropProps = (targetFolderId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragMemoryId) return;
      e.preventDefault();
      setDropFolderId(targetFolderId);
    },
    onDragLeave: () => setDropFolderId((id) => (id === targetFolderId ? null : id)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropFolderId(null);
      if (!dragMemoryId) return;
      moveMemory(dragMemoryId, targetFolderId);
      setDragMemoryId(null);
      useUiStore.getState().toast(t('toast.moved'));
    },
  });

  return (
    <div className="folders" data-testid="folder-view">
      <div className="folders__bar">
        {folderId !== null && (
          <button
            className="folders__up"
            data-testid="folders-up"
            aria-label={t('folders.up')}
            onClick={() => setFolderId(here?.parentId ?? null)}
          >
            ←
          </button>
        )}
        <nav className="folders__trail" aria-label={t('folders.trailAria')}>
          {trail.map((crumb, i) => (
            <span key={crumb.id ?? '__root__'}>
              {i > 0 && <span className="folders__sep"> › </span>}
              {i === trail.length - 1 ? (
                <span className="folders__here">{crumb.label}</span>
              ) : (
                <button
                  className="folders__crumb"
                  data-testid={`folders-crumb-${crumb.id ?? 'root'}`}
                  onClick={() => setFolderId(crumb.id)}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      </div>

      <div className="folders__grid">
        {folders.map((f) => (
          <button
            key={f.id}
            className={`folder${dropFolderId === f.id ? ' folder--drop' : ''}${
              selectedId === f.id ? ' folder--selected' : ''
            }`}
            data-testid={`folder-${f.id}`}
            onClick={() => select(f.id)}
            onDoubleClick={() => enter(f.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enter(f.id);
            }}
            {...fileDropProps(f.id)}
          >
            <span className="folder__icon" aria-hidden="true">
              <span className="folder__tab" />
              <span className="folder__body" />
            </span>
            <span className="folder__name">{f.label}</span>
            {f.count !== null && <span className="folder__count">{f.count}</span>}
          </button>
        ))}

        {files.map((m) => {
          const source = payload.sources.find((s) => s.id === m.source_id);
          return (
            <div
              key={m.id}
              className={`file${selectedId === m.id ? ' file--selected' : ''}${
                dragMemoryId === m.id ? ' file--dragging' : ''
              }`}
              data-testid={`file-${m.id}`}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={() => setDragMemoryId(m.id)}
              onDragEnd={() => {
                setDragMemoryId(null);
                setDropFolderId(null);
              }}
              onClick={() => select(m.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                select(m.id);
              }}
            >
              <span className="file__icon" aria-hidden="true">▤</span>
              <span className="file__text">{m.text}</span>
              {source && <span className="file__meta">{source.title}</span>}
            </div>
          );
        })}

        {folders.length === 0 && files.length === 0 && (
          <p className="folders__empty">{t('folders.empty')}</p>
        )}
      </div>

      {folderId !== null && folders.length > 0 && files.length === 0 && (
        <p className="folders__hint">{t('folders.enterHint')}</p>
      )}
    </div>
  );
}
