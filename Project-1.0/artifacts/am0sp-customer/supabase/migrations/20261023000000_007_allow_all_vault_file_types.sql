-- Keep the existing customer bucket private while allowing arbitrary file
-- types selected by the customer file picker.
UPDATE storage.buckets
SET public = false,
    allowed_mime_types = NULL
WHERE id = 'am0sp-vault';
