import { randomUUID } from 'node:crypto';
import { SqliteRepository } from '../db/sqlite.ts';
import { importSeed, namespaceSeed } from '../seed/import.ts';
import seedJson from '../../seed/workspace.json' with { type: 'json' };
import type { GraphPayload } from '../../src/core/types.ts';
import { IngestPipeline } from '../pipeline/ingest.ts';
import { AskPipeline } from '../pipeline/ask.ts';
import { selectAi } from '../ai/select.ts';
import { createApiServer } from './server.ts';

/**
 * Entry point. `npm run dev:api`.
 *
 * Defaults to an in-memory database seeded from seed/workspace.json, so a run
 * starts from the same 47-memory corpus the frontend has always shown and ends
 * without leaving state behind. Pass RECALL_DB=path for a durable one.
 *
 * The provider is chosen by `selectAi`: the real Anthropic and Voyage pair when
 * both keys are present, the fixture otherwise. A server that refused to start
 * without an API key would make the whole API layer untestable, so the fixture
 * stays the default rather than the fallback of last resort.
 */

const PORT = Number(process.env.PORT ?? 5174);
const WORKSPACE = process.env.RECALL_WORKSPACE ?? 'ws_demo';
const DB_PATH = process.env.RECALL_DB ?? ':memory:';
/** Set to serve the built client from this process too — see server/http/static.ts. */
const STATIC_ROOT = process.env.RECALL_STATIC;
/** Required for a public deployment; absent means every request may write. */
const INVITE = process.env.RECALL_INVITE;

const repo = new SqliteRepository(DB_PATH);
repo.migrate();

if (!repo.getWorkspace(WORKSPACE)) {
  importSeed(repo, WORKSPACE);
  console.log(`seeded ${WORKSPACE} with ${repo.listMemories(WORKSPACE).length} memories`);
} else {
  console.log(`reusing ${WORKSPACE} (${repo.listMemories(WORKSPACE).length} memories)`);
}

const { ai: provider, embeddings, live, reason } = selectAi();
console.log(`ai provider: ${provider.name} (${reason})`);
/*
 * The dimensionality warning was written when the seed carried 8-dimensional
 * authored vectors and any live provider disagreed with them. The seed now
 * carries openai/text-embedding-3-small at 1024, so the warning is only true
 * when the running embedder is a different width — which is a comparison, not
 * an assumption.
 */
const seededWidth = repo.getGraphPayload(WORKSPACE).memories[0]?.vector.length ?? 0;
if (live && seededWidth > 0 && seededWidth !== embeddings.dimensions) {
  console.warn(
    `the corpus is ${seededWidth}-dimensional and this provider returns ` +
      `${embeddings.dimensions} — re-embed before trusting retrieval (npm run reembed)`,
  );
}

if (STATIC_ROOT && !INVITE) {
  console.warn(
    'RECALL_STATIC is set without RECALL_INVITE: anyone who finds this URL can ' +
      'spend the API keys it holds. Set RECALL_INVITE before exposing it.',
  );
}

const server = createApiServer(
  {
    repo,
    ingest: new IngestPipeline(repo, provider, embeddings),
    ask: new AskPipeline(repo, provider, embeddings),
    reset: (workspaceId) => {
      repo.deleteWorkspace(workspaceId);
      importSeed(repo, workspaceId);
    },
    /*
     * A visitor gets a copy rather than a share. The schema was always
     * multi-tenant, so this is a seed import under a new id — no migration,
     * and no way for one visitor's deletions to reach another's screen.
     */
    createWorkspace: () => {
      const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      // Namespaced, because the seed's primary keys are fixed and a second
      // import of them collides — see `namespaceSeed`.
      importSeed(repo, id, namespaceSeed(seedJson as unknown as GraphPayload, id));
      return id;
    },
    inviteToken: INVITE,
  },
  STATIC_ROOT,
);

server.listen(PORT, () => {
  console.log(
    `Recall on http://localhost:${PORT}  ` +
      `(db: ${DB_PATH}, provider: ${provider.name}, ` +
      `${STATIC_ROOT ? 'serving the client' : 'api only'}, ` +
      `${INVITE ? 'invite required to write' : 'writes open'})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      repo.close();
      process.exit(0);
    });
  });
}
