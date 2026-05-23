-- Tracks orders that the cashier edited locally so subsequent syncs from the
-- Google Sheet leave them alone. The row is still recognised (no insert, no
-- soft-delete), but no values are overwritten.
ALTER TABLE "order" ADD COLUMN sync_locked INTEGER NOT NULL DEFAULT 0;
