-- Ensure the customer vault exists and remains private.
-- Safe to apply repeatedly; existing objects are not modified.
INSERT INTO storage.buckets (id, name, public)
VALUES ('am0sp-vault', 'am0sp-vault', false)
ON CONFLICT (id) DO UPDATE
SET public = false;
