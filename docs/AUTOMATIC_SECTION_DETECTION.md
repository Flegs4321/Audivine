# Automatic Section Detection & Summarization Architecture

## Architecture Comparison

### Architecture A: Heuristic Segmentation + LLM Classification (RECOMMENDED for V1)

**Flow:**
1. Live transcription → accumulate transcript chunks with timestamps
2. Heuristic segmentation → detect natural breaks (silence, pauses, keyword cues)
3. Chunk grouping → merge consecutive chunks into candidate segments (30-60s windows)
4. LLM classification → classify each segment as Announcements/Sharing/Sermon/Other
5. Segment merging → merge consecutive segments of same type with gaps < threshold
6. LLM summarization → generate summaries and sermon bullets

**Pros:**
- ✅ Cost-effective (only process segments, not entire transcript)
- ✅ Fast (heuristics run client-side, LLM only for classification/summarization)
- ✅ Real-time feedback possible (can show candidate segments as they're detected)
- ✅ Tunable (adjust silence thresholds, keyword patterns)
- ✅ Works with partial transcripts (can start classifying while recording)
- ✅ Lower latency (heuristics are instant)

**Cons:**
- ❌ Requires tuning heuristics (silence detection thresholds, keyword patterns)
- ❌ May miss subtle transitions that LLM would catch
- ❌ Keyword-based detection requires maintenance of keyword lists

---

### Architecture B: Pure LLM Segmentation

**Flow:**
1. Live transcription → accumulate full transcript
2. Send entire transcript to LLM with prompt: "Segment into Announcements/Sharing/Sermon"
3. LLM returns structured JSON with sections + timestamps
4. LLM summarization → generate summaries and sermon bullets

**Pros:**
- ✅ Intelligent context understanding
- ✅ Handles language variations naturally
- ✅ Single LLM pass for segmentation
- ✅ Can understand implicit transitions

**Cons:**
- ❌ Higher cost (process entire transcript multiple times)
- ❌ Slower (must wait for full transcript, then process)
- ❌ Less control over segmentation logic
- ❌ Harder to debug/tune
- ❌ No real-time feedback

---

## Recommendation: Architecture A (Heuristic + LLM)

**Rationale:**
1. **Cost**: Process ~20-30 segments vs entire transcript = 10-20x cost savings
2. **Speed**: Heuristics are instant, LLM calls are parallelized
3. **Iterative improvement**: Can tune heuristics based on real data
4. **Flexibility**: Can add more sophisticated heuristics later (speaker diarization, etc.)
5. **User experience**: Can show segmentation progress in real-time

**Future improvements:**
- Add speaker diarization for better transition detection
- Use embeddings for semantic similarity between chunks
- Fine-tune a small model for classification (eliminate LLM dependency)
- Add confidence scores for manual review prioritization

---

## V1 Implementation Plan

### Phase 1: Segmentation
1. Chunk transcript into windows (30-60 seconds of speech)
2. Detect breaks: silence gaps > 2 seconds, keyword cues, topic shifts
3. Create candidate segments with start/end times

### Phase 2: Classification
1. Extract text from each candidate segment
2. Call LLM API with classification prompt
3. Return: `{ label: "Announcements" | "Sharing" | "Sermon" | "Other", confidence: number }`
4. Filter out "Other" segments (music, prayers, silence)

### Phase 3: Merging
1. Merge consecutive segments of same type (gaps < 5 seconds)
2. Adjust boundaries to natural breaks
3. Generate final section list with timestamps

### Phase 4: Summarization
1. For each section, extract full text
2. Call LLM API for section summary (2-4 sentences)
3. For Sermon, additionally generate bullet points (5-10 bullets)

### Phase 5: Human Review
1. Display sections in editable UI
2. Allow adjusting start/end times
3. Allow editing text/summaries/bullets
4. Allow re-running summarization per section

---

## File Structure

```
/app/recorder/page.tsx              # Main recording UI (update with review step)
/lib/segmenter/
  ├── types.ts                      # Type definitions
  ├── chunker.ts                    # Break transcript into candidate segments
  ├── classifier.ts                 # LLM classification (abstracted)
  ├── merger.ts                     # Merge consecutive segments
  └── index.ts                      # Main segmentation pipeline
/lib/summarizer/
  ├── types.ts                      # Summary types
  ├── summarize.ts                  # LLM summarization (abstracted)
  └── index.ts                      # Summary generation pipeline
/app/api/analyze/
  └── route.ts                      # API endpoint for classification + summarization
/app/recorder/review/
  └── page.tsx                      # Human review/edit UI
```

