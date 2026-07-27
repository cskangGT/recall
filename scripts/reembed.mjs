#!/usr/bin/env node
/**
 * Re-embeds a workspace with the live provider.
 *
 * The seed ships 8-dimensional hand-authored vectors, tuned so the demo's split
 * fires. Voyage returns 1024. Pointing the server at real embeddings without
 * running this leaves the stored memories in one space and every incoming query
 * in another — cosine between them is noise, so retrieval does not break
 * loudly, it just quietly stops working.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... RECALL_DB=recall.db npm run reembed
 *
 * Afterwards the tuned demo condition no longer holds: the 0.62 split threshold
 * was fitted to those 8-dim vectors. Run `npm run thresholds` next.
 */

import { SqliteRepository } from '../server/db/sqlite.ts';
import { importSeed } from '../server/seed/import.ts';
import { selectAi } from '../server/ai/select.ts';
import { meanPairwiseCosine } from '../src/core/vectorMath.ts';

const WORKSPACE = process.env.RECALL_WORKSPACE ?? 'ws_demo';
const DB_PATH = process.env.RECALL_DB ?? ':memory:';

const { embeddings, live, reason } = selectAi();
if (!live) {
  console.error(`Refusing to run: ${reason}.`);
  console.error('Re-embedding with the fixture provider would be a no-op that looks like success.');
  process.exit(1);
}

const repo = new SqliteRepository(DB_PATH);
repo.migrate();
if (!repo.getWorkspace(WORKSPACE)) {
  importSeed(repo, WORKSPACE);
  console.log(`seeded ${WORKSPACE}`);
}

const memories = repo.listMemories(WORKSPACE);
console.log(`embedding ${memories.length} memories with ${embeddings.dimensions} dimensions…`);

const vectors = await embeddings.embed(memories.map((m) => m.text), 'document');
if (vectors.length !== memories.length) {
  console.error(`got ${vectors.length} vectors for ${memories.length} memories — aborting`);
  process.exit(1);
}

repo.replaceMemoryVectors(WORKSPACE, new Map(memories.map((m, i) => [m.id, vectors[i]])));
console.log('vectors replaced');

// The number the demo hangs on. Reported rather than asserted: this script's job
// is to re-embed, and deciding the threshold is `npm run thresholds`.
const byCategory = new Map();
for (const m of memories) {
  if (!byCategory.has(m.category_id)) byCategory.set(m.category_id, []);
  byCategory.get(m.category_id).push(vectors[memories.indexOf(m)]);
}

const payload = repo.getGraphPayload(WORKSPACE);
const nameOf = new Map(payload.categories.map((c) => [c.id, c.name]));
console.log('\nmean pairwise cosine per category (old threshold was 0.62):');
for (const [categoryId, vs] of byCategory) {
  if (vs.length < 2) continue;
  console.log(`  ${String(nameOf.get(categoryId) ?? categoryId).padEnd(24)} ${meanPairwiseCosine(vs).toFixed(4)}  (n=${vs.length})`);
}
console.log('\nNext: npm run thresholds — the 0.62 gate was fitted to the seed vectors.');
