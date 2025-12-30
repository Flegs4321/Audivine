# Database Migration Instructions

## Apply the Migration

You have two options to apply the migration:

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New query**
4. Copy and paste the contents of `supabase/migrations/001_create_recordings_table.sql`
5. Click **Run** or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
6. You should see "Success. No rows returned"

### Option 2: Using Supabase CLI

If you have Supabase CLI installed:

```bash
# Link your project (if not already linked)
supabase link --project-ref your-project-ref

# Apply the migration
supabase db push
```

## Verify the Migration

After applying the migration, verify it worked:

1. Go to **Table Editor** in your Supabase dashboard
2. You should see a new `recordings` table
3. Check that it has the following columns:
   - `id` (uuid)
   - `filename` (text)
   - `file_path` (text)
   - `storage_url` (text)
   - `duration` (integer)
   - `segments` (jsonb)
   - `transcript_chunks` (jsonb)
   - `mime_type` (text)
   - `file_size` (bigint)
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Table Structure

The `recordings` table stores:
- **id**: Unique identifier (UUID)
- **filename**: Original filename
- **file_path**: Path in storage bucket (e.g., `recordings/recording-2024-01-01T12-00-00.webm`)
- **storage_url**: Public URL to access the file
- **duration**: Recording duration in seconds
- **segments**: JSON array of segment objects with type, startMs, endMs
- **transcript_chunks**: JSON array of transcript chunks with text, timestampMs, isFinal
- **mime_type**: Audio file MIME type (e.g., `audio/webm`)
- **file_size**: File size in bytes
- **created_at**: Timestamp when record was created
- **updated_at**: Timestamp when record was last updated

## Row Level Security (RLS)

The table has RLS enabled with:
- **Public read access**: Anyone can read recordings
- **Public insert access**: Anyone can insert new recordings

You can modify these policies in **Authentication** → **Policies** if you want to restrict access.

## Next Steps

After applying the migration:
1. Restart your dev server: `npm run dev`
2. Test recording and uploading
3. Check the `recordings` table in Supabase to see your data

