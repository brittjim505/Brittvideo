-- BrittVideo 0003 — Builder (Phase 3): website analysis, project images, grounded scenes, delivery records.

-- Website analysis (K3, S8): facts are kept WITH their source page so every claim can be traced (grounding).
CREATE TABLE website_analyses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id),
  url           text,
  status        text NOT NULL CHECK (status IN ('succeeded','partial','failed','manual')),
  pages         jsonb NOT NULL DEFAULT '[]',     -- [{url, title, ok, error?}]
  owner_message text,                            -- plain-language result
  created_by_label text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX website_analyses_project_idx ON website_analyses (project_id, created_at DESC);

CREATE TABLE project_facts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id),
  analysis_id   uuid REFERENCES website_analyses(id),
  text          text NOT NULL CHECK (length(trim(text)) > 0),
  source_url    text,                            -- NULL = typed by the owner
  source_kind   text NOT NULL CHECK (source_kind IN ('website','owner')),
  selected      boolean NOT NULL DEFAULT true,   -- owner decides which facts may be used (K5, human review)
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_facts_project_idx ON project_facts (project_id, position);

-- Images chosen for a project (Review Images step).
CREATE TABLE project_images (
  project_id    uuid NOT NULL REFERENCES projects(id),
  asset_id      uuid NOT NULL REFERENCES assets(id),
  selected      boolean NOT NULL DEFAULT true,
  position      integer NOT NULL DEFAULT 0,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, asset_id)
);

-- Asset extras for the Image Library (T2, T8, T10).
ALTER TABLE assets ADD COLUMN alt_text text;
ALTER TABLE assets ADD COLUMN outdated_flag boolean NOT NULL DEFAULT false;

-- Which facts each scene's narration came from (grounding; not part of the approvable content hash).
ALTER TABLE scenes ADD COLUMN fact_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE scenes ADD COLUMN written_by text;           -- 'templates' | 'ai:<model>' | 'owner' | 'imported'

-- Delivery history (N11, N13): every delivery is recorded; never overwritten.
CREATE TABLE delivery_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id),
  kit_hash      text NOT NULL,                   -- exactly which approved version was delivered
  method        text NOT NULL,
  reference     text,
  delivered_at  timestamptz NOT NULL DEFAULT now(),
  recorded_by_label text NOT NULL
);
CREATE TRIGGER delivery_records_append_only BEFORE UPDATE OR DELETE ON delivery_records
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

CREATE TABLE download_events (
  id            bigserial PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id),
  kind          text NOT NULL,                   -- complete_kit | script | image_sources
  kit_hash      text,
  file_name     text NOT NULL,
  by_label      text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
