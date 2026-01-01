# Implementation Guide: Automatic Section Detection

## Setup Instructions

### 1. Install Dependencies

No additional dependencies required (using native fetch for API calls).

### 2. Environment Variables

Copy `.env.example` to `.env.local` and add your OpenAI API key:

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini
```

### 3. Integration Steps

#### Step 1: Update Recorder Page

In `app/recorder/page.tsx`, after recording ends, call the analysis API:

```typescript
// After handleEndRecording, add:
const handleAnalyze = async () => {
  if (!audioBlob || transcriptChunks.length === 0) return;
  
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunks: transcriptChunks,
        totalDurationMs: elapsedTimeRef.current * 1000,
      }),
    });
    
    const result = await response.json();
    
    // Store result and navigate to review page
    localStorage.setItem(`recording-sections-${recordingId}`, JSON.stringify(result.sections));
    router.push(`/recorder/review?id=${recordingId}`);
  } catch (error) {
    console.error('Analysis failed:', error);
  }
};
```

#### Step 2: Add "Analyze" Button

Add a button after "End Recording" that triggers analysis:

```typescript
{state === "stopped" && (
  <button onClick={handleAnalyze}>
    Analyze Sections
  </button>
)}
```

#### Step 3: Test with Mock Provider

Initially, the system will use `MockClassificationProvider` if no API key is set. This allows testing the segmentation logic without API costs.

## Architecture Details

### Segmentation Flow

1. **Chunking**: Break transcript into 30-60s segments based on:
   - Silence gaps (>2s)
   - Keyword detection (announcements, sharing, sermon cues)
   - Maximum duration (2min forced break)

2. **Classification**: Each segment is classified via LLM:
   - Input: Segment text + keywords
   - Output: Label + confidence score

3. **Merging**: Consecutive segments of same type are merged:
   - Gaps <5s are merged
   - Final sections have clean boundaries

4. **Summarization**: Each section gets:
   - 2-4 sentence summary
   - Sermon sections: 5-10 bullet points

### Customization

#### Adjust Segmentation Config

Edit `lib/segmenter/types.ts`:

```typescript
export const DEFAULT_CONFIG: SegmentationConfig = {
  minSegmentDurationMs: 30000,    // Minimum 30s segments
  maxSegmentDurationMs: 120000,   // Max 2min before forced break
  silenceThresholdMs: 2000,       // 2s silence = break
  mergeGapThresholdMs: 5000,      // Merge if gap <5s
  keywords: {
    announcements: [...],          // Add custom keywords
    sharing: [...],
    sermon: [...],
  },
};
```

#### Swap LLM Provider

Implement `ClassificationProvider` or `SummarizationProvider` interfaces:

```typescript
// lib/segmenter/classifier.ts
export class AnthropicClassificationProvider implements ClassificationProvider {
  async classify(segment: CandidateSegment) {
    // Implement Anthropic API call
  }
}
```

## Next Steps

1. ✅ Core segmentation pipeline
2. ✅ LLM abstraction layer
3. ✅ Review/edit UI
4. ⏳ Integrate with recorder page
5. ⏳ Save sections to database
6. ⏳ Export MP3 with metadata
7. ⏳ Add confidence scores to UI
8. ⏳ Add speaker diarization
9. ⏳ Fine-tune classification model

## Testing

### Test Segmentation Locally

```typescript
import { segmentTranscript } from '@/lib/segmenter';

const chunks = [
  { text: "Welcome everyone...", timestampMs: 0 },
  { text: "Now for announcements...", timestampMs: 30000 },
  // ... more chunks
];

const result = await segmentTranscript(chunks, 3600000); // 1 hour
console.log(result.sections);
```

### Test with Mock Provider

Without API key, system uses mock providers that classify based on keywords. Good for testing UI and segmentation logic.

## Cost Estimation

- **Classification**: ~$0.001-0.002 per segment (gpt-4o-mini)
- **Summarization**: ~$0.005-0.01 per section (gpt-4o-mini)
- **Typical 1-hour service**: 20-30 segments = $0.02-0.06 total

