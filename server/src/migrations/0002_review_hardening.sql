-- BrittVideo 0002 — hardening from the independent review (2026-09-27).

-- An order can have at most ONE paid payment and at most ONE in-flight (pending) payment, whatever the retry key.
-- Clean up any duplicates first so the upgrade can never fail on existing data (keeps the earliest).
UPDATE payments p SET status = 'cancelled', failure_message = 'Duplicate payment record closed by upgrade 0002 — review with support.'
 WHERE status IN ('paid', 'pending')
   AND EXISTS (SELECT 1 FROM payments q WHERE q.order_id = p.order_id AND q.status = p.status AND (q.created_at, q.id) < (p.created_at, p.id));
CREATE UNIQUE INDEX payments_one_paid_per_order ON payments (order_id) WHERE status = 'paid';
CREATE UNIQUE INDEX payments_one_pending_per_order ON payments (order_id) WHERE status = 'pending';

-- Serialise Super User changes so two Super Users cannot demote each other at the same moment (V9).
CREATE OR REPLACE FUNCTION bv_guard_last_super_user() RETURNS trigger AS $$
DECLARE remaining int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'super_user' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'super_user' AND OLD.status = 'active'
         AND (NEW.role <> 'super_user' OR NEW.status <> 'active')) THEN
    PERFORM pg_advisory_xact_lock(815001);
    SELECT count(*) INTO remaining FROM users
      WHERE role = 'super_user' AND status = 'active' AND id <> OLD.id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'BV_LAST_SUPER_USER: the last active Super User cannot be removed' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
