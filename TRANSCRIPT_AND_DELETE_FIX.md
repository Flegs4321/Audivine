# Transcript Saving and Delete Fix

## Current Status

### Transcripts
✅ **Transcripts ARE already being saved!** When you upload a recording, the transcript chunks are automatically saved to the `transcript_chunks` column in the `recordings` table in Supabase.

### Delete Issue
❌ **Delete is failing silently** - The UI removes recordings optimistically, but if the Supabase delete fails, they reappear when the page refreshes.

## Fix: Apply DELETE RLS Policy

The DELETE policy exists in the migration file but may not have been applied to your Supabase database.

### Steps to Fix:

1. **Go to your Supabase Dashboard**
   - Navigate to **SQL Editor**

2. **Run this SQL to add the DELETE policy:**
   ```sql
   -- Add DELETE policy to allow deleting recordings
   CREATE POLICY IF NOT EXISTS "Allow public delete" ON recordings
     FOR DELETE
     USING (true);
   ```

3. **Verify the policy exists:**
   - Go to **Authentication** → **Policies** → **recordings** table
   - You should see a policy named "Allow public delete" for DELETE operations

4. **Test deletion:**
   - Try deleting a recording from your app
   - Check the browser console (F12) for any error messages
   - Verify the recording is actually deleted in Supabase Table Editor

## Verify Transcripts Are Being Saved

1. **Go to Supabase Dashboard** → **Table Editor** → **recordings**
2. **Click on any recording** to view its details
3. **Check the `transcript_chunks` column** - it should contain a JSON array like:
   ```json
   [
     {
       "text": "Hello, welcome to today's service...",
       "timestampMs": 0,
       "isFinal": true
     },
     {
       "text": "Let's begin with announcements...",
       "timestampMs": 5000,
       "isFinal": true
     }
   ]
   ```

## If Delete Still Fails

Check the browser console (F12 → Console tab) when you try to delete. Look for:
- Error messages from the delete API
- RLS policy errors
- Permission denied errors

The delete API route has extensive logging - check the Network tab to see the API response.

