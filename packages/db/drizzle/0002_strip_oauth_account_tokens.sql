-- Provider credentials were stored by the Auth.js adapter on every sign-in
-- and never read back: the GitHub access token is used once, transiently,
-- to fetch the verified profile. From Phase 5 the adapter strips them
-- before the row is written; this clears what earlier sign-ins left behind,
-- so a database dump cannot hand over a live GitHub credential (audit,
-- ADR 0002's argument applied to the other token in the building).
UPDATE "accounts"
SET "access_token" = NULL,
    "refresh_token" = NULL,
    "id_token" = NULL
WHERE "access_token" IS NOT NULL
   OR "refresh_token" IS NOT NULL
   OR "id_token" IS NOT NULL;
