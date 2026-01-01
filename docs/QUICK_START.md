# Quick Start: Automatic Section Detection

## What Was Created

A complete automatic section detection and summarization system for church service recordings.

### Core Files

1. **Segmentation Pipeline** (`lib/segmenter/`)
   - `types.ts` - Type definitions
   - `chunker.ts` - Heuristic-based transcript chunking
   - `classifier.ts` - LLM classification (OpenAI + Mock providers)
   - `merger.ts` - Merges consecutive segments
   - `index.ts` - Main pipeline entry point

2. **Summarization** (`lib/summarizer/`)
   - `types.ts` - Summary types
   - `summarize.ts` - LLM summarization (OpenAI + Mock providers)
   - `index.ts` - Summary generation pipeline

3. **API Routes** (`app/api/`)
   - `analyze/route.ts` - Full analysis (segmentation + classification + summarization)
   - `summarize/route.ts` - Regenerate summary for a section

4. **Review UI** (`app/recorder/review/`)
   - `page.tsx` - Human review and edit interface
   - `types.ts` - Review types

5. **Documentation** (`docs/`)
   - `AUTOMATIC_SECTION_DETECTION.md` - Architecture comparison and plan
   - `IMPLEMENTATION_GUIDE.md` - Setup and customization guide
   - `QUICK_START.md` - This file

## Next Steps to Integrate

### 1. Add OpenAI API Key

Create `.env.local`:
```bash
OPENAI_API_KEY=sk-your-key-here
```

### 2. Update Recorder Page

In `app/recorder/page.tsx`, add analysis trigger after recording ends:

```typescript
const handleAnalyze = async () => {
  if (!audioBlob || transcriptChunks.length === 0) {
    setError("No recording or transcript available");
    return;
  }

  try {
    setUploadStatus("uploading"); // Reuse upload status for analysis
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks: transcriptChunksRef.current,
        totalDurationMs: elapsedTimeRef.current * 1000,
      }),
    });

    if (!response.ok) throw new Error("Analysis failed");

    const result = await response.json();
    
    // Store for review (temporary - replace with database save)
    const recordingId = `recording-${Date.now()}`;
    localStorage.setItem(
      `recording-sections-${recordingId}`,
      JSON.stringify(result.sections)
    );
    
    // Navigate to review page
    router.push(`/recorder/review?id=${recordingId}`);
  } catch (error) {
    setUploadError(error instanceof Error ? error.message : "Analysis failed");
    setUploadStatus("error");
  }
};
```

Add button in UI (after End Recording):
```tsx
{state === "stopped" && audioBlob && (
  <button
    onClick={handleAnalyze}
    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
  >
    Analyze Sections
  </button>
)}
```

### 3. Test Without API Key

The system will use `MockClassificationProvider` and `MockSummarizationProvider` if no API key is set. This allows testing the UI and segmentation logic without costs.

### 4. Test With API Key

Once API key is added, the system will use real OpenAI classification and summarization.

## How It Works

1. **Recording ends** → Transcript chunks with timestamps are available
2. **User clicks "Analyze"** → Chunks sent to `/api/analyze`
3. **Segmentation** → Heuristics break transcript into 30-60s segments
4. **Classification** → LLM classifies each segment (Announcements/Sharing/Sermon/Other)
5. **Merging** → Consecutive segments of same type are merged
6. **Summarization** → LLM generates summaries and sermon bullets
7. **Review** → User can edit times, text, summaries, and bullets
8. **Export** → (TODO) Export MP3 with metadata

## Cost Estimation

- **Classification**: ~$0.001-0.002 per segment (gpt-4o-mini)
- **Summarization**: ~$0.005-0.01 per section (gpt-4o-mini)
- **Typical 1-hour service**: 20-30 segments = **$0.02-0.06 total**

## Customization

See `docs/IMPLEMENTATION_GUIDE.md` for:
- Adjusting segmentation thresholds
- Adding custom keywords
- Swapping LLM providers
- Fine-tuning classification

