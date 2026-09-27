-- BrittVideo 0001 — core domain schema (Phase 1 + Phase 2 foundations)
-- Forward-only. Never edit after it has been applied anywhere; add a new migration instead.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bv_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

-- Rows in append-only tables may never be changed or removed (history is business truth).
CREATE OR REPLACE FUNCTION bv_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BV_APPEND_ONLY: % rows cannot be % (history is preserved)', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Users, sessions, audit (V1–V12)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  display_name    text NOT NULL,
  role            text NOT NULL CHECK (role IN ('super_user','admin','user')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash   text NOT NULL,
  grants          text[] NOT NULL DEFAULT '{}',          -- explicit extra permissions (Appendix D)
  elevated_until  timestamptz,                            -- time-limited elevated access (V11)
  elevated_grants text[] NOT NULL DEFAULT '{}',
  must_change_password boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz,
  last_login_at   timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();

-- V9: the last active Super User can never be disabled, demoted or deleted — enforced in the database too.
CREATE OR REPLACE FUNCTION bv_guard_last_super_user() RETURNS trigger AS $$
DECLARE remaining int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'super_user' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'super_user' AND OLD.status = 'active'
         AND (NEW.role <> 'super_user' OR NEW.status <> 'active')) THEN
    SELECT count(*) INTO remaining FROM users
      WHERE role = 'super_user' AND status = 'active' AND id <> OLD.id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'BV_LAST_SUPER_USER: the last active Super User cannot be removed' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER users_last_super_user BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION bv_guard_last_super_user();

CREATE TABLE sessions (
  id           text PRIMARY KEY,                 -- SHA-256 of the cookie token; the token itself is never stored
  user_id      uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  locked_at    timestamptz,                      -- set during an in-person iPad demo; owner password unlocks
  user_agent   text,
  ip           text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  ip         text,
  success    boolean NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), at DESC);

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id),
  actor_label   text NOT NULL,                   -- "Jim Britt (Super User)", "Prospect signup", "System job"
  action        text NOT NULL,                   -- e.g. client.created, price_book.published
  entity_type   text,
  entity_id     text,
  summary       text NOT NULL,                   -- plain-language one-liner
  before_data   jsonb,
  after_data    jsonb,
  request_id    text
);
CREATE INDEX audit_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_at_idx ON audit_events (at DESC);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

-- ---------------------------------------------------------------------------
-- Protected secrets (V18, U6, S16). Ciphertext only; the API never returns values.
-- ---------------------------------------------------------------------------
CREATE TABLE secrets (
  name        text PRIMARY KEY,                  -- e.g. square.access_token
  ciphertext  text NOT NULL,                     -- AES-256-GCM, base64(iv|tag|data)
  hint        text,                              -- last 4 characters, for "Connected (…a1b2)"
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- Prospects and clients (B2/B3, K2, R5, R10)
-- ---------------------------------------------------------------------------
CREATE TABLE prospects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL CHECK (length(trim(business_name)) > 0),
  website_url   text,
  website_norm  text,                             -- normalised host+path used for duplicate detection
  industry      text NOT NULL CHECK (industry IN ('senior_care','dental','attorneys','other')),
  business_type text,                             -- required for OTHER (e.g. Plumbing) — B3
  contact_name  text,
  email         text,
  phone         text,
  private_notes text,                             -- never shown in prospect-safe mode
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','demoed','converted','archived')),
  converted_client_id uuid,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT prospects_other_needs_type CHECK (industry <> 'other' OR length(trim(coalesce(business_type,''))) > 0)
);
CREATE UNIQUE INDEX prospects_dedupe_uq ON prospects (lower(trim(business_name)), coalesce(website_norm,''))
  WHERE archived_at IS NULL;
CREATE TRIGGER prospects_touch BEFORE UPDATE ON prospects FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();

CREATE TABLE clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_number serial UNIQUE,
  business_name text NOT NULL CHECK (length(trim(business_name)) > 0),
  website_url   text,
  website_norm  text,
  industry      text NOT NULL CHECK (industry IN ('senior_care','dental','attorneys','other')),
  business_type text,
  contact_name  text,
  email         text,
  phone         text,
  private_notes text,
  source        text NOT NULL,                     -- demo_ipad | demo_zoom | demo_link | manual | migration
  source_prospect_id uuid UNIQUE REFERENCES prospects(id), -- one prospect converts to at most one client
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT clients_other_needs_type CHECK (industry <> 'other' OR length(trim(coalesce(business_type,''))) > 0)
);
CREATE UNIQUE INDEX clients_dedupe_uq ON clients (lower(trim(business_name)), coalesce(website_norm,''))
  WHERE archived_at IS NULL;
CREATE TRIGGER clients_touch BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();
ALTER TABLE prospects ADD CONSTRAINT prospects_converted_fk FOREIGN KEY (converted_client_id) REFERENCES clients(id);

-- Clients and projects are archived, never hard-deleted, once they have orders/history.
CREATE OR REPLACE FUNCTION bv_no_hard_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BV_NO_HARD_DELETE: % records are archived, not deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER clients_no_delete BEFORE DELETE ON clients FOR EACH ROW EXECUTE FUNCTION bv_no_hard_delete();

-- ---------------------------------------------------------------------------
-- Marketing preference (O4–O8, R13, V22, Q24). Durable; cannot be reset by projects/migration/restore.
-- ---------------------------------------------------------------------------
CREATE TABLE marketing_preferences (
  client_id     uuid PRIMARY KEY REFERENCES clients(id),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','unsubscribed')),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  changed_by    text NOT NULL,
  reason        text,
  resubscribe_evidence text                        -- required to leave 'unsubscribed'
);
CREATE OR REPLACE FUNCTION bv_guard_unsubscribe() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'unsubscribed' AND NEW.status <> 'unsubscribed'
     AND (NEW.resubscribe_evidence IS NULL OR NEW.resubscribe_evidence = coalesce(OLD.resubscribe_evidence,'')) THEN
    RAISE EXCEPTION 'BV_UNSUBSCRIBE_PROTECTED: an unsubscribe can only be reversed with the client''s own recorded re-consent'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER marketing_pref_guard BEFORE UPDATE ON marketing_preferences
  FOR EACH ROW EXECUTE FUNCTION bv_guard_unsubscribe();
CREATE TRIGGER marketing_pref_no_delete BEFORE DELETE ON marketing_preferences
  FOR EACH ROW EXECUTE FUNCTION bv_no_hard_delete();

CREATE TABLE marketing_preference_events (
  id         bigserial PRIMARY KEY,
  client_id  uuid NOT NULL REFERENCES clients(id),
  from_status text,
  to_status  text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  by_label   text NOT NULL,
  reason     text
);
CREATE TRIGGER marketing_pref_events_append_only BEFORE UPDATE OR DELETE ON marketing_preference_events
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

-- ---------------------------------------------------------------------------
-- Pricing (M2–M8, R12, Delta commercial model). Versions are immutable once published.
-- ---------------------------------------------------------------------------
CREATE TABLE price_book_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no   integer NOT NULL UNIQUE,
  items        jsonb NOT NULL,     -- {"video_kit":{"label":..,"billing":"one_time","amount_cents":99700}, ...}
  packages     jsonb NOT NULL,     -- {"standard":{"label":..,"lines":["video_kit"]}, "premier":{...}}
  note         text,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users(id)
);
CREATE TRIGGER price_book_append_only BEFORE UPDATE OR DELETE ON price_book_versions
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

-- ---------------------------------------------------------------------------
-- Demo & Sales (B1, E1, G1, H1, J1, V13, V15)
-- ---------------------------------------------------------------------------
CREATE TABLE demo_library_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text,
  industry        text NOT NULL CHECK (industry IN ('senior_care','dental','attorneys','other','all')),
  business_type   text,
  kind            text NOT NULL,          -- website_video | social | email | quick_video | sample_script
  purpose         text,
  duration_s      integer CHECK (duration_s IS NULL OR (duration_s > 0 AND duration_s <= 120)),
  format          text,                   -- 16x9 | 9x16 | 1x1
  media_url       text,                   -- hosted playback URL (Vimeo etc.) or /media/… path
  poster_url      text,
  permission_state text NOT NULL DEFAULT 'owner_created'
                  CHECK (permission_state IN ('owner_created','client_permission_granted','permission_pending')),
  permission_evidence text,
  published       boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 100,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- V23/O13: client work may only be published with recorded permission
  CONSTRAINT demo_publish_needs_permission CHECK (NOT published OR permission_state <> 'permission_pending')
);
CREATE TRIGGER demo_library_touch BEFORE UPDATE ON demo_library_items FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();

CREATE TABLE demo_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL CHECK (channel IN ('ipad_in_person','mac_zoom','demo_link')),
  prospect_id   uuid REFERENCES prospects(id),
  demo_link_id  uuid,
  business_name text NOT NULL,
  website_url   text,
  industry      text NOT NULL CHECK (industry IN ('senior_care','dental','attorneys','other')),
  business_type text,
  token_hash    text UNIQUE,              -- prospect-safe access token for this session (hash only)
  started_by    uuid REFERENCES users(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  converted_order_id uuid
);

CREATE TABLE demo_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  prospect_id   uuid REFERENCES prospects(id),
  label         text NOT NULL,
  business_name text NOT NULL,
  website_url   text,
  industry      text NOT NULL CHECK (industry IN ('senior_care','dental','attorneys','other')),
  business_type text,
  allow_signup  boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  disabled_at   timestamptz,
  last_viewed_at timestamptz,
  view_count    integer NOT NULL DEFAULT 0
);
ALTER TABLE demo_sessions ADD CONSTRAINT demo_sessions_link_fk FOREIGN KEY (demo_link_id) REFERENCES demo_links(id);

-- ---------------------------------------------------------------------------
-- Orders, agreements, payments (M9–M20, S3, V17). No card data is ever stored.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     serial UNIQUE,
  client_id        uuid NOT NULL REFERENCES clients(id),
  package          text NOT NULL CHECK (package IN ('standard','premier','quick_video','additional_work')),
  price_book_version_id uuid NOT NULL REFERENCES price_book_versions(id),
  status           text NOT NULL CHECK (status IN ('pending_payment','paid','payment_failed','cancelled','refunded')),
  source_channel   text NOT NULL CHECK (source_channel IN ('ipad_in_person','mac_zoom','demo_link','manual','migration')),
  demo_session_id  uuid UNIQUE REFERENCES demo_sessions(id),   -- one sale per demo session
  sale_key         text NOT NULL UNIQUE,                       -- idempotency key of the sale request
  created_by_label text NOT NULL,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION bv_no_hard_delete();
ALTER TABLE demo_sessions ADD CONSTRAINT demo_sessions_order_fk FOREIGN KEY (converted_order_id) REFERENCES orders(id);

CREATE TABLE order_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id),
  item_code          text NOT NULL,
  label              text NOT NULL,
  billing            text NOT NULL CHECK (billing IN ('one_time','monthly')),
  list_price_cents   integer CHECK (list_price_cents IS NULL OR list_price_cents >= 0), -- NULL = no list price (Quick Video, M8)
  agreed_price_cents integer NOT NULL CHECK (agreed_price_cents >= 0),
  sold_price_cents   integer NOT NULL CHECK (sold_price_cents >= 0),
  override_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- M4/R12: prices at sale are historical truth and never rewritten.
CREATE TRIGGER order_lines_append_only BEFORE UPDATE OR DELETE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

CREATE TABLE agreements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL UNIQUE REFERENCES orders(id),
  package              text NOT NULL,
  terms_version        text NOT NULL,
  terms_text           text NOT NULL,
  terms_sha256         text NOT NULL,
  accepted_name        text NOT NULL,
  accepted_email       text,
  accepted_at          timestamptz NOT NULL DEFAULT now(),
  accepted_ip          text,
  accepted_user_agent  text
);
CREATE TRIGGER agreements_append_only BEFORE UPDATE OR DELETE ON agreements
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id),
  provider          text NOT NULL,                 -- square | test | manual
  mode              text NOT NULL CHECK (mode IN ('test','live')),
  idempotency_key   text NOT NULL UNIQUE,          -- sent to the provider; prevents duplicate charges (M15)
  provider_payment_ref text,                       -- provider's order/payment id — reference only
  payment_link_url  text,
  amount_cents      integer NOT NULL CHECK (amount_cents >= 0),
  status            text NOT NULL CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  failure_message   text,                          -- plain language
  method_note       text,                          -- e.g. "Check #1042" for manual payments
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();

CREATE TABLE payment_events (
  id                 bigserial PRIMARY KEY,
  payment_id         uuid REFERENCES payments(id),
  provider           text NOT NULL,
  provider_event_id  text,
  kind               text NOT NULL,
  status             text,
  raw_summary        jsonb,                         -- redacted provider payload (no card data)
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

-- ---------------------------------------------------------------------------
-- Premier membership + quarterly obligations (Delta, P1–P15). Scheduler arrives in Phase 7.
-- ---------------------------------------------------------------------------
CREATE TABLE premier_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id),
  order_id        uuid NOT NULL UNIQUE REFERENCES orders(id),
  status          text NOT NULL CHECK (status IN ('pending_start','active','cancelled')),
  monthly_price_cents integer NOT NULL,            -- copied at sale; never derived from today's price book
  started_at      timestamptz,                     -- actual Premier start (P3): set when payment succeeds
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX premier_one_active_per_client ON premier_memberships (client_id) WHERE status IN ('pending_start','active');
CREATE TRIGGER premier_touch BEFORE UPDATE ON premier_memberships FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();
CREATE TRIGGER premier_no_delete BEFORE DELETE ON premier_memberships FOR EACH ROW EXECUTE FUNCTION bv_no_hard_delete();

CREATE TABLE quarterly_obligations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id   uuid NOT NULL REFERENCES premier_memberships(id),
  period_index    integer NOT NULL CHECK (period_index >= 1),
  due_at          timestamptz NOT NULL,
  status          text NOT NULL CHECK (status IN ('upcoming','in_progress','delivered','skipped_cancelled')),
  project_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, period_index)              -- P14: never two obligations for one quarter
);

-- ---------------------------------------------------------------------------
-- Projects, deliverables, content, approvals (K1–K17, Y4–Y6)
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number  serial UNIQUE,
  client_id       uuid REFERENCES clients(id),
  prospect_id     uuid REFERENCES prospects(id),   -- speculative/demo builds for a prospect (e.g. Morada)
  order_id        uuid REFERENCES orders(id),
  kind            text NOT NULL CHECK (kind IN ('video_kit','quick_video','email_video','premier_quarterly','provider_test')),
  title           text NOT NULL,
  status          text NOT NULL DEFAULT 'ready_to_start'
                  CHECK (status IN ('ready_to_start','in_progress','awaiting_approval','approved','in_production',
                                    'ready_for_review','ready_for_delivery','delivered','archived')),
  included_in_premier boolean NOT NULL DEFAULT false,  -- P7/M19: quarterly work is not a new sale
  industry        text,
  business_type   text,
  story           text,
  tone            text,
  settings        jsonb NOT NULL DEFAULT '{}',        -- builder choices (length, platform, quick-video details …)
  video_provider  text,                               -- chosen at creation; never silently switched (U17)
  workflow_step   integer NOT NULL DEFAULT 1,
  source          text NOT NULL CHECK (source IN ('sale','manual','migration','premier_schedule','provider_test')),
  legacy_ref      text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  CONSTRAINT projects_owner_required CHECK (kind = 'provider_test' OR client_id IS NOT NULL OR prospect_id IS NOT NULL)
);
-- One primary Video Kit project per order: repeated callbacks/retries cannot create duplicates (Q9, M16).
CREATE UNIQUE INDEX projects_one_kit_per_order ON projects (order_id) WHERE kind = 'video_kit' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX projects_legacy_ref_uq ON projects (legacy_ref) WHERE legacy_ref IS NOT NULL;
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();
CREATE TRIGGER projects_no_delete BEFORE DELETE ON projects FOR EACH ROW EXECUTE FUNCTION bv_no_hard_delete();
ALTER TABLE quarterly_obligations ADD CONSTRAINT quarterly_project_fk FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE deliverables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id),
  kind            text NOT NULL CHECK (kind IN ('website','social_a','social_b','email','quick')),
  label           text NOT NULL,
  duration_s      integer NOT NULL CHECK (duration_s IN (15,30,60,90,120)),  -- K13/K14: max 120 s
  formats         text[] NOT NULL,                  -- subset of {16x9,9x16,1x1}
  required        boolean NOT NULL DEFAULT true,
  position        integer NOT NULL,
  script_text     text NOT NULL DEFAULT '',
  script_hash     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind),
  CONSTRAINT deliverables_formats_valid CHECK (formats <@ ARRAY['16x9','9x16','1x1']::text[] AND cardinality(formats) >= 1)
);
CREATE TRIGGER deliverables_touch BEFORE UPDATE ON deliverables FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();

CREATE TABLE scenes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id  uuid NOT NULL REFERENCES deliverables(id),
  position        integer NOT NULL,
  name            text NOT NULL,
  start_s         integer NOT NULL CHECK (start_s >= 0),
  end_s           integer NOT NULL CHECK (end_s > start_s AND end_s <= 120),
  image_ref       jsonb,                            -- {asset_id} or {title, source_url, source_note}
  visual          text NOT NULL DEFAULT '',
  narration       text NOT NULL DEFAULT '',
  content_hash    text NOT NULL,                    -- SHA-256 of the approvable content
  content_version integer NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deliverable_id, position)
);

-- Approval ledger: append-only. An approval is valid only while its content_hash equals the subject's current hash.
CREATE TABLE approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id),
  subject_type    text NOT NULL CHECK (subject_type IN ('scene','script','deliverable','kit')),
  subject_id      uuid NOT NULL,
  content_hash    text NOT NULL,
  decision        text NOT NULL CHECK (decision IN ('approved','revoked')),
  reason          text,
  decided_by      uuid REFERENCES users(id),
  decided_by_label text NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_subject_idx ON approvals (subject_type, subject_id, decided_at DESC);
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

-- Material changes are recorded (ApprovalInvalidation) whenever approved content is edited.
CREATE TABLE approval_invalidations (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES projects(id),
  subject_type    text NOT NULL,
  subject_id      uuid NOT NULL,
  previous_hash   text NOT NULL,
  new_hash        text NOT NULL,
  reason          text NOT NULL,
  at              timestamptz NOT NULL DEFAULT now(),
  by_label        text NOT NULL
);
CREATE TRIGGER approval_invalidations_append_only BEFORE UPDATE OR DELETE ON approval_invalidations
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

-- Production / delivery record carried over from the prototype (honest states; no provider automation yet).
CREATE TABLE production_records (
  project_id      uuid PRIMARY KEY REFERENCES projects(id),
  status          text NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started','needs_reapproval','approved','package_downloaded','delivered')),
  approved_at     timestamptz,
  package_downloaded_at timestamptz,
  delivered_at    timestamptz,
  delivery_method text,
  delivery_reference text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Assets / Image Library (T1–T21). Permanent deletion leaves a tombstone so nothing resurrects it (T14, Q23).
-- ---------------------------------------------------------------------------
CREATE TABLE assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid REFERENCES clients(id),       -- NULL = reusable BrittVideo library image
  kind            text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','audio','document')),
  title           text NOT NULL,
  category        text,
  source_type     text NOT NULL CHECK (source_type IN ('website','library_upload','online','migration','production_output')),
  source_url      text,
  rights_note     text,
  status          text NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','approved','do_not_use','recently_deleted','permanently_deleted')),
  protection_class text NOT NULL DEFAULT 'working' CHECK (protection_class IN ('temporary','working','master','delivered')),
  storage_key     text,                              -- NULL once permanently deleted
  sha256          text,
  bytes           bigint,
  mime            text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  legacy_ref      text
);
CREATE INDEX assets_sha_idx ON assets (sha256);
CREATE UNIQUE INDEX assets_legacy_ref_uq ON assets (legacy_ref) WHERE legacy_ref IS NOT NULL;
CREATE TRIGGER assets_touch BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION bv_touch_updated_at();
CREATE OR REPLACE FUNCTION bv_guard_tombstone() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'permanently_deleted' AND NEW.status <> 'permanently_deleted' THEN
    RAISE EXCEPTION 'BV_DELETED_MEANS_DELETED: a permanently deleted asset cannot be restored' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER assets_tombstone_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION bv_guard_tombstone();

-- ---------------------------------------------------------------------------
-- Work protection: autosave drafts, checkpoints, continue-working (Q1–Q7, L5)
-- ---------------------------------------------------------------------------
CREATE TABLE drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  draft_key       text NOT NULL,                  -- e.g. prospect-form, project:<id>:settings
  payload         jsonb NOT NULL,
  revision        integer NOT NULL DEFAULT 1,     -- optimistic concurrency; stale writes are refused
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, draft_key)
);

CREATE TABLE checkpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id),
  stage           text NOT NULL,                  -- e.g. created, scripts_built, approved, delivered, before_restore
  reason          text NOT NULL,
  snapshot        jsonb NOT NULL,
  created_by_label text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkpoints_project_idx ON checkpoints (project_id, created_at DESC);
CREATE TRIGGER checkpoints_append_only BEFORE UPDATE OR DELETE ON checkpoints
  FOR EACH ROW EXECUTE FUNCTION bv_append_only();

CREATE TABLE user_activity (
  user_id         uuid PRIMARY KEY REFERENCES users(id),
  route           text NOT NULL,
  entity_type     text,
  entity_id       text,
  label           text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Idempotency + jobs (Q8–Q10, "every scheduled job must be safe to run twice")
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  scope           text NOT NULL,
  key             text NOT NULL,
  request_hash    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  PRIMARY KEY (scope, key)
);

CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  dedupe_key      text UNIQUE,                    -- the same logical job is never queued twice
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead')),
  run_at          timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 5,
  last_error      text,                           -- plain-language
  locked_at       timestamptz,
  locked_by       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs (status, run_at);

-- ---------------------------------------------------------------------------
-- Integrations, health, recovery, support, diagnostics, backups (Q12–Q21, S15, U28)
-- ---------------------------------------------------------------------------
CREATE TABLE integration_settings (
  kind            text NOT NULL CHECK (kind IN ('payment','video','hosting','email','sms','storage')),
  role            text NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','backup')),
  provider        text NOT NULL,
  public_config   jsonb NOT NULL DEFAULT '{}',    -- never contains secrets
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id),
  PRIMARY KEY (kind, role)
);

CREATE TABLE health_checks (
  id              bigserial PRIMARY KEY,
  component       text NOT NULL,
  status          text NOT NULL CHECK (status IN ('normal','recovered','not_configured','attention','support_needed')),
  owner_message   text NOT NULL,
  detail          text,
  checked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_checks_component_idx ON health_checks (component, checked_at DESC);

CREATE TABLE recovery_events (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  area            text NOT NULL,
  what_happened   text NOT NULL,                  -- plain language
  outcome         text NOT NULL CHECK (outcome IN ('recovered_automatically','needs_attention','support_needed')),
  detail          text,                           -- redacted technical detail
  resolved_at     timestamptz
);

CREATE TABLE diagnostic_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  level           text NOT NULL CHECK (level IN ('info','warn','error')),
  area            text NOT NULL,
  message         text NOT NULL,
  context         jsonb,                          -- redacted before insert
  request_id      text
);
CREATE INDEX diagnostic_log_at_idx ON diagnostic_log (at DESC);

CREATE TABLE support_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_label text NOT NULL,
  trigger         text NOT NULL CHECK (trigger IN ('owner_request','automatic')),
  summary         text NOT NULL,
  body            text NOT NULL,                  -- redacted; safe to send
  sent_at         timestamptz,
  sent_via        text
);

CREATE TABLE backups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('scheduled','manual','pre_migration','pre_restore','pre_import')),
  status          text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  file_name       text,
  bytes           bigint,
  sha256          text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  verified_at     timestamptz,
  verify_status   text CHECK (verify_status IN ('passed','failed')),
  owner_message   text
);

-- ---------------------------------------------------------------------------
-- Prototype migration bookkeeping (R21, R22, Y22)
-- ---------------------------------------------------------------------------
CREATE TABLE migration_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_sha256     text NOT NULL UNIQUE,           -- importing the same file twice is a no-op
  imported_at     timestamptz NOT NULL DEFAULT now(),
  imported_by_label text NOT NULL,
  summary         jsonb NOT NULL
);
CREATE TABLE legacy_refs (
  source          text NOT NULL,
  legacy_id       text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  PRIMARY KEY (source, legacy_id, entity_type)
);
