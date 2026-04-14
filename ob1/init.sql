-- =============================================================================
-- OB1 (Open Brain) Local Init Script
-- Sets up pgvector, per-agent schemas, thoughts tables, and search functions.
-- Runs once on first database start via Docker entrypoint.
-- =============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- =============================================================================
-- Helper: create the full OB1 schema inside a given schema name.
-- Call once per agent to get isolated thought stores.
-- =============================================================================
CREATE OR REPLACE FUNCTION create_ob1_schema(schema_name TEXT) RETURNS void AS $$
BEGIN
  -- Create the schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  -- Thoughts table
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.thoughts (
      id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
      content       text        NOT NULL,
      embedding     vector(1536),
      metadata      jsonb       DEFAULT '{}'::jsonb,
      content_fingerprint text,
      created_at    timestamptz DEFAULT now(),
      updated_at    timestamptz DEFAULT now()
    )
  $sql$, schema_name);

  -- Indexes
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_thoughts_embedding ON %I.thoughts USING hnsw (embedding vector_cosine_ops)', schema_name, schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_thoughts_metadata  ON %I.thoughts USING gin (metadata)', schema_name, schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_thoughts_created   ON %I.thoughts (created_at DESC)', schema_name, schema_name);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS idx_%s_thoughts_fingerprint ON %I.thoughts (content_fingerprint) WHERE content_fingerprint IS NOT NULL', schema_name, schema_name);

  -- Auto-update trigger
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %I.update_updated_at() RETURNS trigger AS $t$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $t$ LANGUAGE plpgsql
  $sql$, schema_name);

  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS thoughts_updated_at ON %I.thoughts
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TRIGGER thoughts_updated_at
      BEFORE UPDATE ON %I.thoughts
      FOR EACH ROW
      EXECUTE FUNCTION %I.update_updated_at()
  $sql$, schema_name, schema_name);

  -- Semantic search function
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %I.match_thoughts(
      query_embedding vector(1536),
      match_threshold float DEFAULT 0.7,
      match_count     int   DEFAULT 10,
      filter          jsonb DEFAULT '{}'::jsonb
    )
    RETURNS TABLE (
      id          uuid,
      content     text,
      metadata    jsonb,
      similarity  float,
      created_at  timestamptz
    )
    LANGUAGE plpgsql AS $fn$
    BEGIN
      RETURN QUERY
      SELECT
        t.id,
        t.content,
        t.metadata,
        (1 - (t.embedding <=> query_embedding))::float AS similarity,
        t.created_at
      FROM %I.thoughts t
      WHERE (1 - (t.embedding <=> query_embedding)) > match_threshold
        AND (filter = '{}'::jsonb OR t.metadata @> filter)
      ORDER BY t.embedding <=> query_embedding
      LIMIT match_count;
    END;
    $fn$
  $sql$, schema_name, schema_name);

  -- Upsert function (deduplication via content fingerprint)
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %I.upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
    RETURNS JSONB AS $fn$
    DECLARE
      v_fingerprint TEXT;
      v_result      JSONB;
      v_id          UUID;
    BEGIN
      v_fingerprint := encode(sha256(convert_to(
        lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
        'UTF8'
      )), 'hex');

      INSERT INTO %I.thoughts (content, content_fingerprint, metadata)
      VALUES (p_content, v_fingerprint, COALESCE(p_payload->'metadata', '{}'::jsonb))
      ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
      SET updated_at = now(),
          metadata   = %I.thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
      RETURNING id INTO v_id;

      v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
      RETURN v_result;
    END;
    $fn$ LANGUAGE plpgsql
  $sql$, schema_name, schema_name, schema_name);

END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Create per-agent schemas
-- =============================================================================
SELECT create_ob1_schema('orchestrator');
SELECT create_ob1_schema('agent1');
SELECT create_ob1_schema('agent2');

-- Also set up the public schema as a shared/default brain
SELECT create_ob1_schema('public');

-- =============================================================================
-- PostgREST roles (needed for REST API access)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD current_setting('app.settings.db_password', true);
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, orchestrator, agent1, agent2 TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orchestrator TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent1       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent2       TO anon;
GRANT anon TO authenticator;
