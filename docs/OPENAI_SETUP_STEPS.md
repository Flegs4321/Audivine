# OpenAI Setup Steps

## Step 1: Get Your OpenAI API Key

1. Go to [https://platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Navigate to **API Keys** (left sidebar)
4. Click **"Create new secret key"**
5. Copy the key (starts with `sk-...`)
   - ⚠️ **Save it now** - you won't be able to see it again!

---

## Step 2: Add API Key to Local Environment

1. Open your `.env.local` file in the project root
2. Add this line:
   ```bash
   OPENAI_API_KEY=sk-your-actual-key-here
   ```
3. Save the file
4. **Restart your dev server** (if running):
   ```bash
   # Stop the server (Ctrl+C)
   npm run dev
   ```

---

## Step 3: Add API Key to Vercel

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **Audivine** project
3. Go to **Settings** → **Environment Variables**
4. Click **"Add New"**
5. Add:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: Your OpenAI API key (starts with `sk-...`)
   - **Environment**: Select all (Production, Preview, Development)
6. Click **"Save"**
7. **Redeploy** your project (or it will auto-deploy on next push)

---

## Step 4: Test the Connection

### Option A: Test via Sermons Page (Recommended)

1. Go to your app: `http://localhost:3000/sermons`
2. Upload a test audio file (or use an existing recording)
3. After upload, you should see the recording in the list
4. Click on a recording to view it
5. The transcription/analysis will happen automatically (once integrated)

### Option B: Test API Directly

You can test the transcription API directly:

```bash
# First, get a recording ID from your database
# Then test transcription:
curl -X POST http://localhost:3000/api/sermons/transcribe \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recordingId": "your-recording-id"}'
```

---

## Step 5: Verify It's Working

### Check Console Logs

When you call the transcription or analysis APIs, check:
- ✅ No "OpenAI API key not configured" errors
- ✅ Successful API responses
- ✅ Transcripts appearing in database

### Check Database

1. Go to Supabase Dashboard → **Table Editor** → `recordings`
2. Find your test recording
3. Check the `transcript_chunks` column - should have data after transcription
4. Check the `segments` column - should have data after analysis

---

## Step 6: Integrate into Upload Flow (Next)

Once the API key is set up, you'll want to:

1. **Auto-transcribe after upload** - Modify `/api/sermons/upload` to trigger transcription
2. **Auto-analyze after transcription** - Chain the analysis after transcription completes
3. **Add UI buttons** - Add "Transcribe" and "Analyze" buttons to sermons page
4. **Show progress** - Display loading states during processing

---

## Troubleshooting

### Error: "OpenAI API key not configured"
- ✅ Check `.env.local` has `OPENAI_API_KEY=sk-...`
- ✅ Restart dev server after adding env var
- ✅ Check Vercel environment variables are set

### Error: "Incorrect API key provided"
- ✅ Verify the key starts with `sk-`
- ✅ Check for extra spaces or quotes
- ✅ Make sure you copied the full key

### Error: "Rate limit exceeded"
- ✅ You're making too many requests
- ✅ Wait a few minutes and try again
- ✅ Check your OpenAI usage dashboard

### Transcription takes too long
- ✅ Normal for 60-minute recordings (can take 2-5 minutes)
- ✅ Check network connection
- ✅ Verify file size isn't too large

---

## Cost Monitoring

1. Go to [OpenAI Usage Dashboard](https://platform.openai.com/usage)
2. Monitor your spending
3. Set up billing alerts if needed
4. Expected cost: **~$0.73-$1.75/month** for 4 services

---

## Next: Integration Steps

After API key is set up, we'll integrate:
1. ✅ Auto-transcribe on upload
2. ✅ Auto-analyze after transcription
3. ✅ UI buttons for manual trigger
4. ✅ Progress indicators

