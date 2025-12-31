# Quick Fix for Supabase Errors

## Error: "new row violates row-level security policy"

This error means the database migration hasn't been run yet. The `recordings` table either doesn't exist or doesn't have the correct RLS policies.

### Solution: Run the Migration

1. **Go to your Supabase Dashboard**
   - Navigate to your project at [https://supabase.com/dashboard](https://supabase.com/dashboard)

2. **Open SQL Editor**
   - Click on **SQL Editor** in the left sidebar
   - Click **New query**

3. **Run the Migration**
   - Open the file: `supabase/migrations/001_create_recordings_table.sql`
   - Copy ALL the SQL code from that file
   - Paste it into the SQL Editor in Supabase
   - Click **Run** (or press Ctrl+Enter / Cmd+Enter)
   - You should see "Success. No rows returned"

4. **Verify the Table**
   - Go to **Table Editor** in the left sidebar
   - You should see a `recordings` table
   - Check that it has all the columns (id, filename, file_path, etc.)

## Error: Storage 400 Error

This might be a storage bucket policy issue. Check:

1. **Verify Bucket Exists**
   - Go to **Storage** in Supabase dashboard
   - Make sure the `Audivine` bucket exists
   - Make sure it's set to **Public bucket**

2. **Check Storage Policies**
   - Go to **Storage** → **Policies**
   - Make sure there's a policy that allows:
     - **INSERT** (for uploading)
     - **SELECT** (for reading/downloading)
   - If no policies exist, you can create them:

   ```sql
   -- Allow anyone to upload files
   CREATE POLICY "Allow public uploads"
   ON storage.objects FOR INSERT
   TO public
   WITH CHECK (bucket_id = 'Audivine');

   -- Allow anyone to read files
   CREATE POLICY "Allow public reads"
   ON storage.objects FOR SELECT
   TO public
   USING (bucket_id = 'Audivine');
   ```

## After Fixing

1. **Restart your dev server** (if running):
   ```bash
   npm run dev
   ```

2. **Test again**:
   - Record something
   - Stop recording
   - Check that upload succeeds without errors

## Note

The storage upload should work even if the database insert fails (you'll see a warning but the file will still be uploaded). However, you won't be able to track recordings in the database until you run the migration.

