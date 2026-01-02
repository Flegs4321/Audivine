-- Storage bucket policies for Audivine bucket
-- These policies allow authenticated users to upload and manage logos
-- 
-- IMPORTANT: Make sure the 'Audivine' storage bucket exists before running this migration
-- You can create it in Supabase Dashboard: Storage > New Bucket > Name: "Audivine" > Public: Yes

-- Drop existing policies if they exist (to allow re-running this migration)
DO $$
BEGIN
  -- Drop policies if they exist
  DROP POLICY IF EXISTS "Allow authenticated users to upload logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated users to update own logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated users to delete own logos" ON storage.objects;
  DROP POLICY IF EXISTS "Allow public read access to logos" ON storage.objects;
EXCEPTION
  WHEN undefined_table THEN
    -- storage.objects table doesn't exist, skip
    NULL;
END $$;

-- Allow authenticated users to upload files to logos/ folder
CREATE POLICY "Allow authenticated users to upload logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'logos'
);

-- Allow authenticated users to update their own logos
CREATE POLICY "Allow authenticated users to update own logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'logos' AND
  (storage.foldername(name))[2] LIKE 'church-logo-' || auth.uid()::text || '.%'
)
WITH CHECK (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'logos' AND
  (storage.foldername(name))[2] LIKE 'church-logo-' || auth.uid()::text || '.%'
);

-- Allow authenticated users to delete their own logos
CREATE POLICY "Allow authenticated users to delete own logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'logos' AND
  (storage.foldername(name))[2] LIKE 'church-logo-' || auth.uid()::text || '.%'
);

-- Allow public read access to logos (so logos can be displayed)
CREATE POLICY "Allow public read access to logos"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'Audivine' AND
  (storage.foldername(name))[1] = 'logos'
);

