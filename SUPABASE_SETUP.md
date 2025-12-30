# Supabase Storage Setup Guide

## 1. Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign up/login
2. Create a new project
3. Wait for the project to be fully provisioned

## 2. Get Your API Keys

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (this is your `NEXT_PUBLIC_SUPABASE_URL`)
   - **anon/public key** (this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

## 3. Create Storage Bucket

1. In your Supabase dashboard, go to **Storage**
2. Click **New bucket**
3. Name it: `Audivine` (case-sensitive)
4. Set it to **Public bucket** (so files can be accessed via public URLs)
5. Click **Create bucket**

## 4. Set Up Environment Variables

1. Create a `.env.local` file in the root of your project
2. Add the following:

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

Replace `your_project_url_here` and `your_anon_key_here` with the values from step 2.

## 5. Optional: Set Up Storage Policies

By default, the bucket should allow public access. If you want to restrict access:

1. Go to **Storage** → **Policies** in your Supabase dashboard
2. Create policies as needed (e.g., allow authenticated users to upload, allow public to read)

## 6. Restart Your Dev Server

After setting up `.env.local`, restart your Next.js dev server:

```bash
npm run dev
```

## Testing

1. Start a recording
2. Stop the recording
3. The audio file will automatically upload to Supabase Storage
4. You'll see the upload status and a public URL when complete

## File Structure in Supabase

Files will be stored in the `Audivine` bucket with the path:
```
recordings/recording-YYYY-MM-DDTHH-MM-SS.webm
```

Note: The folder path is still `recordings/` but the bucket name is `Audivine`.

