# Next Steps: Integrate Automatic Section Detection

## Step 1: Add Required Imports

Add `useRouter` from Next.js to the imports at the top of `app/recorder/page.tsx`:

```typescript
import { useRouter } from "next/navigation";
```

## Step 2: Add Router Hook

Inside the `RecorderPageContent` function, add the router:

```typescript
function RecorderPageContent() {
  const router = useRouter();
  const transcription = useTranscription();
  // ... rest of your existing code
```

## Step 3: Add Analysis Function

Add this function after `handleUploadToSupabase` (around line 411):

```typescript
const handleAnalyzeSections = async () => {
  if (!audioBlob || transcriptChunksRef.current.length === 0) {
    setError("No recording or transcript available for analysis");
    return;
  }

  try {
    setUploadStatus("uploading");
    setUploadError(null);

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks: transcriptChunksRef.current,
        totalDurationMs: elapsedTimeRef.current * 1000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Analysis failed: ${response.statusText}`);
    }

    const result = await response.json();

    // Generate a recording ID (you can replace this with actual recording ID from upload)
    const recordingId = uploadedUrl 
      ? `recording-${Date.now()}` 
      : `recording-${Date.now()}`;

    // Store sections temporarily (replace with database save later)
    localStorage.setItem(
      `recording-sections-${recordingId}`,
      JSON.stringify(result.sections)
    );

    // Navigate to review page
    router.push(`/recorder/review?id=${recordingId}`);
  } catch (err) {
    console.error("Analysis error:", err);
    setUploadError(err instanceof Error ? err.message : "Failed to analyze sections");
    setUploadStatus("error");
  }
};
```

## Step 4: Add "Analyze Sections" Button

Find where you display the audio playback (after "stopped" state), and add the button. Look for where `audioUrl` is displayed and add this button nearby:

```typescript
{/* After the audio playback element, add: */}
{state === "stopped" && audioBlob && transcriptChunks.length > 0 && (
  <div className="mt-6">
    <button
      onClick={handleAnalyzeSections}
      disabled={uploadStatus === "uploading"}
      className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
    >
      {uploadStatus === "uploading" ? "Analyzing..." : "Analyze Sections Automatically"}
    </button>
    <p className="mt-2 text-sm text-gray-600">
      Automatically detect and label Announcements, Sharing, and Sermon sections
    </p>
  </div>
)}
```

## Step 5: (Optional) Set Up OpenAI API Key

If you want to use real LLM classification (instead of the mock provider):

1. Create `.env.local` in your project root (if it doesn't exist)
2. Add your OpenAI API key:

```bash
OPENAI_API_KEY=sk-your-key-here
```

**Note**: If you don't add an API key, the system will use mock providers that classify based on keywords. This is fine for testing!

## Step 6: Test It Out!

1. Start your dev server: `npm run dev`
2. Go to `/recorder`
3. Record something (even just 30-60 seconds)
4. Make sure transcription is working (you should see transcript text)
5. Click "End Recording"
6. Click "Analyze Sections Automatically"
7. You should be redirected to the review page where you can see/edit the detected sections

## Troubleshooting

- **"No transcript available"**: Make sure transcription is enabled and working
- **Analysis fails**: Check browser console for errors. The API route should be at `/api/analyze`
- **No sections detected**: Try recording for at least 1-2 minutes with clear speech
- **Mock classification**: If you don't have an API key, sections will be classified based on keywords only

## What Happens Next?

After analysis:
1. Sections are detected and classified
2. Summaries are generated
3. You're taken to the review page (`/recorder/review`)
4. You can edit times, text, summaries, and bullets
5. Save changes (currently to localStorage - you'll want to save to database later)

## Future Improvements

- Save sections to database instead of localStorage
- Link sections to the uploaded recording
- Export MP3 with metadata/chapters
- Add confidence scores to UI
- Allow re-running analysis with different settings

