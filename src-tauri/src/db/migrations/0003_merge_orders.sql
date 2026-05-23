-- Merge-orders feature.
--
-- merged_into_id: when set, this order has been folded into another order
-- (the master). The donor row is also soft-deleted (deleted_at set) and is
-- treated as "not a real order" for everything except sync.
ALTER TABLE "order" ADD COLUMN merged_into_id TEXT
    REFERENCES "order"(id);
CREATE INDEX idx_order_merged_into ON "order"(merged_into_id);

-- order_item.source_row: which sheet row produced this item. For non-merged
-- orders this matches the parent order's source_row. For merged masters the
-- master holds items from multiple source_rows; sync uses this tag to refresh
-- only the items that belong to the row currently being parsed.
ALTER TABLE order_item ADD COLUMN source_row INTEGER;
UPDATE order_item
   SET source_row = (
     SELECT source_row FROM "order" WHERE "order".id = order_item.order_id
   );
