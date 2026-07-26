import { SqliteRepository } from '../db/sqlite.ts';
import { importSeed } from '../seed/import.ts';
import { IngestPipeline } from '../pipeline/ingest.ts';
import { AskPipeline } from '../pipeline/ask.ts';
import { FixtureProvider, FixtureEmbeddings } from '../ai/fixture.ts';
import { createApiServer } from './server.ts';

/**
 * Entry point. `npm run dev:api`.
 *
 * Defaults to an in-memory database seeded from seed/workspace.json, so a run
 * starts from the same 47-memory corpus the frontend has always shown and ends
 * without leaving state behind. Pass RECALL_DB=path for a durable one.
 *
 * The provider is the fixture: there are no credentials, and a server that
 * refuses to start without an API key would make the whole API layer
 * untestable. Swapping in a real provider is a constructor argument.
 */

const PORT = Number(process.env.PORT ?? 5174);
const WORKSPACE = process.env.RECALL_WORKSPACE ?? 'ws_demo';
const DB_PATH = process.env.RECALL_DB ?? ':memory:';

const repo = new SqliteRepository(DB_PATH);
repo.migrate();

if (!repo.getWorkspace(WORKSPACE)) {
  importSeed(repo, WORKSPACE);
  console.log(`seeded ${WORKSPACE} with ${repo.listMemories(WORKSPACE).length} memories`);
} else {
  console.log(`reusing ${WORKSPACE} (${repo.listMemories(WORKSPACE).length} memories)`);
}

const provider = new FixtureProvider();
const embeddings = new FixtureEmbeddings();

const server = createApiServer({
  repo,
  ingest: new IngestPipeline(repo, provider, embeddings),
  ask: new AskPipeline(repo, provider, embeddings),
  reset: (workspaceId) => {
    repo.deleteWorkspace(workspaceId);
    importSeed(repo, workspaceId);
  },
});

server.listen(PORT, () => {
  console.log(`Recall API on http://localhost:${PORT}  (db: ${DB_PATH}, provider: ${provider.name})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      repo.close();
      process.exit(0);
    });
  });
}
