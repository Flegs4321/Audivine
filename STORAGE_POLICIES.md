# Supabase Storage Policies Setup

## Fix Storage 400 Error

The 400 error when uploading to storage is usually caused by missing storage bucket policies.

## Step-by-Step Fix

### 1. Check Your Bucket

1. Go to your Supabase Dashboard
2. Navigate to **Storage** in the left sidebar
3. Verify the `Audivine` bucket exists
4. Make sure it's set to **Public bucket** (if you want public access)

### 2. Set Up Storage Policies

Go to **Storage** → **Policies** in your Supabase dashboard, then run this SQL:

```sql
-- Allow anyone to upload files to Audivine bucket
CREATE POLICY "Allow public uploads to Audivine"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'Audivine');

-- Allow anyone to read/download files from Audivine bucket
CREATE POLICY "Allow public reads from Audivine"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'Audivine');
```

### 3. Alternative: More Restrictive Policies (Optional)

If you want more control, you can restrict by file path:

```sql
-- Allow uploads only to recordings/ folder
CREATE POLICY "Allow uploads to recordings folder"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'Audivine' 
  AND (storage.foldername(name))[1] = 'recordings'
);

-- Allow reads from recordings/ folder
CREATE POLICY "Allow reads from recordings folder"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'Audivine'
  AND (storage.foldername(name))[1] = 'recordings'
);
```

### 4. Verify Policies

After creating the policies:
1. Go to **Storage** → **Policies**
2. You should see the new policies listed
3. They should show "public" as the target role

### 5. Test

After setting up policies:
1. Restart your dev server (if running)
2. Try recording and uploading again
3. The 400 error should be gone

## Quick Check: Is Bucket Public?

If your bucket is set to **Private**, you'll need authenticated requests. For the current setup (using anon key), make sure the bucket is **Public**.

To check:
1. Go to **Storage** → **Buckets**
2. Click on `Audivine` bucket
3. Look for "Public bucket" toggle - it should be ON

## Troubleshooting

If you still get 400 errors:
1. Check the browser console for more specific error messages
2. Verify the bucket name matches exactly: `Audivine` (case-sensitive)
3. Make sure your `.env.local` has the correct Supabase URL and anon key
4. Try uploading a test file manually in the Supabase dashboard to verify bucket access

