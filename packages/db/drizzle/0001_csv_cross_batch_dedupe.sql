-- No backfill/dedup pass: spec §7 rules out merging or deleting existing
-- duplicate CSV rows before this index is created. This is dev data only; if
-- a database already holds two CSV rows sharing an owner and external id,
-- this migration fails to apply and the duplicates are left to the user's
-- judgment to resolve by hand.
CREATE UNIQUE INDEX "transactions_owner_csv_external_key" ON "transactions" USING btree ("owner_id","external_id") WHERE "provider" = 'csv' AND "external_id" IS NOT NULL;