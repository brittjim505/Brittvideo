-- BrittVideo 0005 — Products as confirmed by the owner (Jim, 2026-10-07):
--   Standard = 5 videos: Website (up to 90 s, shape chosen by the client), Social Portrait 9:16, Social Landscape 16:9,
--   Thank-You Video, Email Video. Premier = the same 5 + hosting, monthly report, a fresh video each quarter.
--   One-Off Video = one Quick Video, $197.
ALTER TABLE deliverables DROP CONSTRAINT IF EXISTS deliverables_kind_check;
ALTER TABLE deliverables ADD CONSTRAINT deliverables_kind_check CHECK (kind IN ('website','social_a','social_b','thank_you','email','quick'));
-- One project per One-Off Video order, as for Video Kits.
DROP INDEX IF EXISTS projects_one_kit_per_order;
CREATE UNIQUE INDEX projects_one_kit_per_order ON projects (order_id) WHERE kind IN ('video_kit','quick_video') AND order_id IS NOT NULL;
