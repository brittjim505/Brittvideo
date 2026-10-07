-- BrittVideo 0004 — GET PICTURES FROM A WEBSITE: pictures can be saved into a prospect's folder as well as a client's.
-- A picture belongs to at most one folder: a client, a prospect, or neither (the general BrittVideo library).
-- When a prospect becomes a client, the client's folder also shows the pictures saved for that prospect.
ALTER TABLE assets ADD COLUMN prospect_id uuid REFERENCES prospects(id);
ALTER TABLE assets ADD CONSTRAINT assets_one_folder CHECK (client_id IS NULL OR prospect_id IS NULL);
CREATE INDEX assets_prospect_idx ON assets (prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX assets_client_idx ON assets (client_id) WHERE client_id IS NOT NULL;
