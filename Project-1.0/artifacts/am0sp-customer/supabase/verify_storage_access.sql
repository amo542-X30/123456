-- Read-only verification; does not return customer file names or contents.
WITH expected_policies(policyname, expected_cmd) AS (
  VALUES
    ('Users can upload own files', 'INSERT'),
    ('Users can read own files', 'SELECT'),
    ('Users can update own files', 'UPDATE'),
    ('Users can delete own files', 'DELETE')
)
SELECT
  'bucket'::text AS check_type,
  'am0sp-vault'::text AS item,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'am0sp-vault') THEN 'MISSING'
    WHEN (SELECT public FROM storage.buckets WHERE id = 'am0sp-vault') THEN 'PUBLIC (unexpected)'
    ELSE 'PRIVATE'
  END AS status,
  COALESCE(
    (SELECT name FROM storage.buckets WHERE id = 'am0sp-vault'),
    'No bucket row'
  ) AS details
UNION ALL
SELECT
  'RLS',
  'storage.objects',
  CASE WHEN c.relrowsecurity THEN 'ENABLED' ELSE 'DISABLED' END,
  'Row-level security'
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'storage' AND c.relname = 'objects'
UNION ALL
SELECT
  'policy',
  e.policyname,
  CASE
    WHEN p.policyname IS NULL THEN 'MISSING'
    WHEN p.cmd::text <> e.expected_cmd THEN 'WRONG COMMAND'
    ELSE 'PRESENT'
  END,
  CASE
    WHEN p.policyname IS NULL THEN 'No matching policy'
    ELSE 'roles=' || COALESCE(array_to_string(p.roles, ','), '(none)')
      || '; using=' || COALESCE(p.qual, '(none)')
      || '; with_check=' || COALESCE(p.with_check, '(none)')
  END
FROM expected_policies AS e
LEFT JOIN pg_policies AS p
  ON p.schemaname = 'storage'
  AND p.tablename = 'objects'
  AND p.policyname = e.policyname
ORDER BY check_type, item;
