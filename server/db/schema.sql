-- Recall backend schema. Spec §11.
--
-- Targets SQLite. The spec names Postgres + pgvector; at this corpus size that
-- is not the right trade. pgvector's HNSW index earns its keep above roughly
-- ten thousand vectors, and Recall's demo corpus is forty-seven — brute-force
-- cosine over the whole set is sub-millisecond. Vectors live in a JSON column
-- and similarity is computed in application code, which also keeps the gate
-- math in `src/core/` as the single implementation rather than splitting it
-- between TypeScript and SQL. `Repository` is the seam: a Postgres
-- implementation slots in behind it when the corpus outgrows this.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  auto_reorganize  INTEGER NOT NULL DEFAULT 1,
  model_tier       TEXT NOT NULL DEFAULT 'fast' CHECK (model_tier IN ('fast', 'thorough')),
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type               TEXT NOT NULL CHECK (type IN ('text', 'link', 'screenshot')),
  title              TEXT NOT NULL,
  raw_content        TEXT NOT NULL,
  scene_description  TEXT,
  url                TEXT,
  image_path         TEXT,
  -- JSON array. URLs found inside a text source and deliberately not fetched,
  -- so a pasted note never silently becomes a webpage scrape (spec §5.2).
  referenced_urls    TEXT NOT NULL DEFAULT '[]',
  detected_context   TEXT,
  summary            TEXT,
  status             TEXT NOT NULL
                       CHECK (status IN ('pending','processing','complete','failed','no_memories')),
  error_message      TEXT,
  created_at         TEXT NOT NULL,
  processed_at       TEXT
);

CREATE INDEX IF NOT EXISTS sources_workspace_created
  ON sources(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  kind          TEXT NOT NULL
                  CHECK (kind IN ('fact','decision','opinion','question','task','reference')),
  confidence    REAL NOT NULL,
  -- JSON array of floats. Dimensionality is the embedding provider's choice
  -- and is asserted to be uniform on write (spec §18).
  vector        TEXT NOT NULL,
  x             REAL,
  y             REAL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_workspace ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS memories_source ON memories(source_id);

-- Keyword half of the hybrid retrieval in spec 9.1. `content=memories` makes
-- this an external-content index: the text is not duplicated, FTS5 reads it
-- back from `memories` by rowid. The triggers below keep it in sync, which an
-- external-content table does not do on its own.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text,
  content = 'memories',
  content_rowid = 'rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (rowid, text) VALUES (NEW.rowid, NEW.text);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts (memories_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF text ON memories BEGIN
  INSERT INTO memories_fts (memories_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
  INSERT INTO memories_fts (rowid, text) VALUES (NEW.rowid, NEW.text);
END;

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES categories(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rationale     TEXT,
  name_locked   INTEGER NOT NULL DEFAULT 0,
  user_created  INTEGER NOT NULL DEFAULT 0,
  x             REAL,
  y             REAL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL CHECK (created_by IN ('ai', 'user')),
  -- Insertion order, preserved explicitly. `created_at` is not enough: a bulk
  -- import writes many rows in the same millisecond, so ties fall back to id
  -- and the taxonomy comes out alphabetical. The seed's authored order is the
  -- map's mental model, and it must be identical whether the payload came from
  -- the JSON file or from here.
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS categories_workspace ON categories(workspace_id);
CREATE INDEX IF NOT EXISTS categories_parent ON categories(parent_id);

-- Exactly two levels (spec §8.5). Enforced by trigger rather than by convention:
-- three-level taxonomies are where automatic organization stops being readable,
-- and the UI already refuses the operation — this is the backstop.
CREATE TRIGGER IF NOT EXISTS categories_depth_insert
BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM categories WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Recall keeps categories two levels deep');
END;

CREATE TRIGGER IF NOT EXISTS categories_depth_update
BEFORE UPDATE OF parent_id ON categories
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM categories WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Recall keeps categories two levels deep');
END;

-- Every memory has exactly one category (spec §8.5) — hence the PK on
-- memory_id alone rather than on the pair.
CREATE TABLE IF NOT EXISTS memory_category (
  memory_id    TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  confidence   REAL NOT NULL,
  -- A user edit is a fact: no reorganization pass may reassign a locked row.
  locked       INTEGER NOT NULL DEFAULT 0,
  assigned_at  TEXT NOT NULL,
  assigned_by  TEXT NOT NULL CHECK (assigned_by IN ('ai', 'user'))
);

CREATE INDEX IF NOT EXISTS memory_category_category ON memory_category(category_id);

CREATE TABLE IF NOT EXISTS entities (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  normalized_name  TEXT NOT NULL,
  kind             TEXT NOT NULL,
  x                REAL,
  y                REAL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  UNIQUE (workspace_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_id         TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alias_normalized  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, alias_normalized)
);

CREATE TABLE IF NOT EXISTS memory_entity (
  memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);

-- Only relates_to is materialized. `contains` and `mentions` are derived from
-- foreign keys at read time; storing them would create a second source of truth
-- that can disagree with the first (spec §11.9).
CREATE TABLE IF NOT EXISTS edges (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  similarity        REAL NOT NULL,
  created_at        TEXT NOT NULL,
  -- Ordered pair, so a bidirectional duplicate cannot be inserted.
  CHECK (source_memory_id < target_memory_id),
  UNIQUE (source_memory_id, target_memory_id)
);

CREATE TABLE IF NOT EXISTS reorg_events (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger_source_id      TEXT REFERENCES sources(id) ON DELETE SET NULL,
  operation              TEXT NOT NULL
                           CHECK (operation IN ('split','merge','promote','new_category','attach_only')),
  status                 TEXT NOT NULL
                           CHECK (status IN ('applied','proposed','undone','dismissed')),
  affected_category_ids  TEXT NOT NULL,
  created_category_ids   TEXT NOT NULL,
  banner_text            TEXT NOT NULL,
  -- Complete snapshot: undo is a pure restore with no recomputation, so it
  -- cannot drift from what was actually replaced (spec §11.10).
  before_state           TEXT NOT NULL,
  after_state            TEXT,
  created_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reorg_events_workspace_created
  ON reorg_events(workspace_id, created_at DESC);

-- Checked before any AI category creation, so a category the user deliberately
-- deleted is not resurrected by the same clustering signal (spec §11.4).
CREATE TABLE IF NOT EXISTS category_tombstones (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  deleted_at    TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS ask_history (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  answer        TEXT,
  citations     TEXT NOT NULL DEFAULT '[]',
  refused       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
