# Delete Policy Setup

## The Issue

Sermons are not deleting because the DELETE policy hasn't been added to your Supabase database.

## Solution

Run this SQL in your Supabase dashboard:

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New query**
4. Copy and paste the following SQL:

```sql
-- Add DELETE policy to allow deleting recordings
CREATE POLICY "Allow public delete" ON recordings
  FOR DELETE
  USING (true);
```

5. Click **Run** or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
6. You should see "Success. No rows returned"

## Verify It Worked

1. Go to **Table Editor** → **recordings** table
2. Click on the table settings/gear icon
3. Check **Policies** tab
4. You should see a policy named "Allow public delete" for DELETE operations

## Alternative: Run the Migration File

You can also run the migration file directly:

1. Open `supabase/migrations/003_add_delete_policy.sql`
2. Copy its contents
3. Paste into Supabase SQL Editor
4. Run it

After running this, the delete functionality should work!

