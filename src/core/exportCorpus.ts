import type { GraphPayload, Memory } from './types.ts';

/**
 * Your corpus, in a form that outlives this program.
 *
 * The agent takes `VACUUM INTO` snapshots, which are the right thing for
 * *recovery* and the wrong thing for everything else: a `.db` file is only
 * openable by something that already knows this schema, and the schema is a
 * detail of an app you are running on one machine. A memory tool whose contents
 * you cannot get out of it is a memory tool you cannot leave, which is a bad
 * property for the place you keep what you know.
 *
 * Two formats, because they answer different questions.
 *
 * **Markdown** is for reading, and for every other tool. It is what you paste
 * into Obsidian, grep six years from now, or print. It is lossy on purpose —
 * vectors and layout coordinates are not things a person wants to see, and a
 * 1024-float array per memory would bury the text they exist to describe.
 *
 * **JSON** is the whole payload, vectors included, so an export can actually be
 * re-imported. It is the same shape `getGraphPayload` returns and
 * `validateSeed` accepts, which is not a coincidence: the seed corpus is a file
 * of exactly this shape, so an export is a workspace someone else could load.
 */

/** Bumped when the shape changes in a way an importer would need to know about. */
export const EXPORT_VERSION = 1;

export interface ExportEnvelope {
  recall_export_version: number;
  exported_at: string;
  workspace: GraphPayload['workspace'];
  counts: { sources: number; memories: number; categories: number; entities: number };
  payload: GraphPayload;
}

export function toJson(payload: GraphPayload, at: Date = new Date()): ExportEnvelope {
  return {
    recall_export_version: EXPORT_VERSION,
    exported_at: at.toISOString(),
    workspace: payload.workspace,
    counts: {
      sources: payload.sources.length,
      memories: payload.memories.length,
      categories: payload.categories.length,
      entities: payload.entities.length,
    },
    payload,
  };
}

/** `2026-08-04` — a date a filename can carry and a person can read. */
export function exportStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function exportFilename(format: 'json' | 'md', at: Date = new Date()): string {
  return `recall-${exportStamp(at)}.${format}`;
}

/**
 * The corpus as a document, organised the way the app organises it: parent
 * categories, their children beneath them, memories under whichever holds them.
 *
 * Ordered rather than dumped. A flat list of 400 sentences is a backup; a
 * structure you can read is what makes an export worth having, and the
 * structure is the part this tool built for you.
 */
export function toMarkdown(payload: GraphPayload, at: Date = new Date()): string {
  const lines: string[] = [];
  const sourceById = new Map(payload.sources.map((s) => [s.id, s]));

  const memoriesOf = (categoryId: string) =>
    payload.memories
      .filter((m) => m.category_id === categoryId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const roots = payload.categories
    .filter((c) => c.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name));

  lines.push(`# ${payload.workspace.name}`, '');
  lines.push(
    `${payload.memories.length} ${payload.memories.length === 1 ? 'memory' : 'memories'} ` +
      `from ${payload.sources.length} ${payload.sources.length === 1 ? 'source' : 'sources'}, ` +
      `exported ${exportStamp(at)}.`,
    '',
  );

  const renderMemory = (m: Memory, depth: string) => {
    const source = sourceById.get(m.source_id);
    /*
     * The provenance is the point. A memory without the thing it came from is
     * a claim, and the whole argument of this app is that a claim you can trace
     * is worth more than one you cannot.
     */
    const where = source
      ? source.url
        ? ` — [${source.title}](${source.url})`
        : ` — ${source.title}`
      : '';
    lines.push(`${depth}- ${m.text}${where}`);
  };

  for (const root of roots) {
    lines.push(`## ${root.name}`, '');

    const direct = memoriesOf(root.id);
    for (const m of direct) renderMemory(m, '');
    if (direct.length > 0) lines.push('');

    const children = payload.categories
      .filter((c) => c.parent_id === root.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      lines.push(`### ${child.name}`, '');
      for (const m of memoriesOf(child.id)) renderMemory(m, '');
      lines.push('');
    }
  }

  /*
   * Anything the structure lost. A memory whose category was deleted between
   * the read and the write, or a corpus with no categories at all — an export
   * that quietly drops rows is worse than no export, so they go at the end
   * under a heading that says what happened.
   */
  const filed = new Set(payload.categories.map((c) => c.id));
  const orphans = payload.memories.filter((m) => !filed.has(m.category_id));
  if (orphans.length > 0) {
    lines.push('## Unfiled', '');
    for (const m of orphans) renderMemory(m, '');
    lines.push('');
  }

  if (payload.memories.length === 0) {
    lines.push('_Nothing saved yet._', '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
