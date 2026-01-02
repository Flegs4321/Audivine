-- Diagnostic query to check recordings and user_id
-- Run this in Supabase SQL Editor to see what's in your database

-- 1. Check all recordings and their user_id
SELECT 
  id,
  filename,
  user_id,
  created_at,
  CASE 
    WHEN user_id IS NULL THEN 'NULL (legacy record)'
    ELSE 'Has user_id'
  END as status
FROM recordings
ORDER BY created_at DESC
LIMIT 20;

-- 2. Check your current user ID
SELECT id, email, created_at 
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- 3. Count recordings by user_id
SELECT 
  CASE 
    WHEN user_id IS NULL THEN 'NULL'
    ELSE user_id::text
  END as user_id_status,
  COUNT(*) as count
FROM recordings
GROUP BY user_id
ORDER BY count DESC;

