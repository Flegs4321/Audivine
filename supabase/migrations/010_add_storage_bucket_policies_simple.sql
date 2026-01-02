-- Simple storage bucket policies for Audivine bucket
-- Apply this if the main migration fails
-- Run this in Supabase SQL Editor

-- Drop policies if they exist first
DROP POLICY IF EXISTS "Allow authenticated upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update own logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete own logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read logos" ON storage.objects;

-- Allow authenticated users to upload to logos folder
CREATE POLICY "Allow authenticated upload logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'Audivine' AND name LIKE 'logos/%');

-- Allow authenticated users to update their own logos
CREATE POLICY "Allow authenticated update own logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'Audivine' AND name LIKE 'logos/church-logo-%' || auth.uid()::text || '.%')
WITH CHECK (bucket_id = 'Audivine' AND name LIKE 'logos/church-logo-%' || auth.uid()::text || '.%');

-- Allow authenticated users to delete their own logos
CREATE POLICY "Allow authenticated delete own logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'Audivine' AND name LIKE 'logos/church-logo-%' || auth.uid()::text || '.%');

-- Allow public read access
CREATE POLICY "Allow public read logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'Audivine' AND name LIKE 'logos/%');

