-- Storage policies for user-specific bulletin templates in Audivine bucket.
-- Path format: bulletin-templates/<auth.uid()>/template.docx
-- These are private per-user files (not public assets).

DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow authenticated users to upload own bulletin template" ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated users to update own bulletin template" ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated users to delete own bulletin template" ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated users to read own bulletin template" ON storage.objects;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE POLICY "Allow authenticated users to upload own bulletin template"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'bulletin-templates' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Allow authenticated users to update own bulletin template"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'bulletin-templates' AND
  (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'bulletin-templates' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Allow authenticated users to delete own bulletin template"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'bulletin-templates' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Allow authenticated users to read own bulletin template"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'bulletin-templates' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

