# User-Specific Sermons Setup

This document outlines the changes made to implement user-specific sermons, where each user only sees and manages their own sermons.

## Changes Made

### 1. Database Migration

A new migration file has been created: `supabase/migrations/004_add_user_id_to_recordings.sql`

This migration:
- Adds a `user_id` column to the `recordings` table
- Creates an index on `user_id` for faster queries
- Updates RLS (Row Level Security) policies to:
  - Allow users to read only their own recordings
  - Allow users to insert only their own recordings
  - Allow users to update only their own recordings
  - Allow users to delete only their own recordings

### 2. API Routes Updated

All API routes now filter by `user_id`:

- **GET /api/sermons**: Returns only sermons for the authenticated user
- **POST /api/sermons/upload**: Associates uploaded sermons with the authenticated user
- **DELETE /api/sermons/delete**: Only allows deletion of the user's own sermons

### 3. Storage Upload Updated

The `uploadRecording` function in `lib/supabase/storage.ts` now includes `user_id` when saving recordings to the database.

## Setup Instructions

### Step 1: Apply the Database Migration

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New query**
4. Copy and paste the contents of `supabase/migrations/004_add_user_id_to_recordings.sql`
5. Click **Run** or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
6. You should see "Success. No rows returned"

### Step 2: Verify the Migration

1. Go to **Table Editor** in your Supabase dashboard
2. Select the `recordings` table
3. Verify that:
   - A new `user_id` column exists (UUID type)
   - An index `idx_recordings_user_id` exists
   - RLS policies are updated (check in **Authentication** → **Policies**)

### Step 3: Test the Changes

1. **Test with User 1:**
   - Log in as User 1
   - Upload a sermon or create a recording
   - Go to Sermons Library
   - You should only see sermons uploaded by User 1

2. **Test with User 2:**
   - Log out
   - Log in as User 2 (or create a new account)
   - Go to Sermons Library
   - You should only see sermons uploaded by User 2 (or an empty list if none)

3. **Test Delete:**
   - As User 1, try to delete a sermon
   - Only sermons owned by User 1 should be deletable
   - Attempting to delete another user's sermon should fail (enforced by RLS)

## Important Notes

### Existing Data

- **Existing recordings without `user_id`**: These will have `user_id` set to `NULL`
- **RLS Policies**: The new policies require `user_id` to match the authenticated user
- **Recommendation**: If you have existing recordings, you may want to:
  1. Assign them to a specific user, OR
  2. Create a migration to assign them to the first admin user

### Security

- RLS policies enforce user isolation at the database level
- Even if API routes have bugs, users cannot access other users' sermons
- The `user_id` is automatically set based on the authenticated session

## Troubleshooting

### Issue: "Unauthorized" errors when fetching sermons

**Solution**: Make sure you're logged in. The API routes require authentication.

### Issue: Can't see any sermons after migration

**Possible causes**:
1. Existing sermons don't have `user_id` set (they're NULL)
2. RLS policies are blocking access

**Solution**: 
- Check if your sermons have `user_id` set in the database
- Verify RLS policies are correctly applied
- You may need to update existing records to assign them to users

### Issue: Can't upload sermons

**Solution**: 
- Make sure you're logged in
- Check that the migration was applied successfully
- Verify RLS policies allow INSERT for authenticated users

## Next Steps

After applying the migration:
1. Test with multiple user accounts
2. Verify that users can only see their own sermons
3. Test upload, delete, and view functionality
4. If you have existing data, consider assigning it to users

