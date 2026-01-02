# OpenAI Cost Estimate for Church Service Recording

## Monthly Cost Estimate

### Assumptions
- **4 services per month**
- **60 minutes per service** = 240 minutes/month total
- **Transcription**: Using OpenAI Whisper API
- **Summarization**: Using gpt-4o-mini

### Transcription Costs

**Option 1: gpt-4o-mini-transcribe** ($0.003/min)
- 240 minutes × $0.003 = **$0.72/month**

**Option 2: gpt-4o-transcribe** ($0.006/min)
- 240 minutes × $0.006 = **$1.44/month**

### Summarization Costs

**Token Estimates per Service:**
- Input: ~60 min audio ≈ 9,000 words ≈ 12,000 tokens
- Output: ~500-1,000 tokens per section × 3 sections = 1,500-3,000 tokens

**gpt-4o-mini Pricing:**
- Input: $0.150 per 1M tokens
- Output: $0.600 per 1M tokens

**Per Service:**
- Input: 12,000 × ($0.150/1,000,000) = $0.0018
- Output: 2,500 × ($0.600/1,000,000) = $0.0015
- **Total per service: ~$0.0033**

**Monthly (4 services):**
- 4 × $0.0033 = **$0.013/month**

### Total Monthly Cost Range

| Scenario | Transcription | Summarization | Total | With 20% Buffer |
|----------|---------------|---------------|-------|-----------------|
| **Low** (mini-transcribe) | $0.72 | $0.01 | $0.73 | **$0.88** |
| **Typical** (mini-transcribe) | $0.72 | $0.01 | $0.73 | **$0.88** |
| **High** (gpt-4o-transcribe) | $1.44 | $0.02 | $1.46 | **$1.75** |

**Note:** Includes buffer for re-runs, testing, and edge cases.

## Annual Cost Estimate
- **Low/Typical**: ~$10.56/year
- **High**: ~$21.00/year

---

## Architecture Proposal

### Flow Diagram
```
Client (Browser)
  ↓ [Record Audio]
  ↓ [Stop & Upload]
Server API Route (/api/sermons/upload)
  ↓ [Store in Supabase Storage]
  ↓ [Call OpenAI Whisper API]
  ↓ [Get Transcript]
  ↓ [Call OpenAI for Segmentation + Summarization]
  ↓ [Store Results in DB]
  ↓ [Return to Client]
Client (Review Page)
```

### Components

1. **Client-Side Recording** (already exists)
   - MediaRecorder API
   - Real-time transcription (optional)
   - Upload on stop

2. **Server-Side Processing**
   - `/api/sermons/upload` - Handle file upload
   - `/api/sermons/transcribe` - OpenAI Whisper transcription
   - `/api/sermons/analyze` - Segmentation + summarization
   - Background job (optional) for async processing

3. **Database Storage**
   - Store transcript chunks
   - Store segments with summaries
   - Store member-ready message

---

## Implementation Notes

### Audio Format Recommendations

**Recommended: WebM/Opus**
- ✅ Browser-native support
- ✅ Good compression (smaller files)
- ✅ Good quality at lower bitrates
- ✅ Already implemented in your app

**Alternative: WAV**
- ✅ Uncompressed (best quality)
- ❌ Large file sizes (~10MB/min)
- ❌ Slower uploads

**Recommendation:** Stick with WebM/Opus for upload, convert to WAV server-side if needed for transcription.

### Chunking Strategy

**For Large Files (>25MB):**
1. Split audio into 25MB chunks
2. Transcribe each chunk separately
3. Merge transcripts in order
4. Process merged transcript for summarization

**Implementation:**
```typescript
// Chunk audio file if > 25MB
const CHUNK_SIZE = 25 * 1024 * 1024; // 25MB
if (file.size > CHUNK_SIZE) {
  // Split and process chunks
}
```

### Retry Handling & Idempotency

**Retry Strategy:**
- Exponential backoff: 1s, 2s, 4s, 8s
- Max 3 retries
- Use recording ID as idempotency key

**Idempotency:**
- Store transcription status in DB
- Check if already processed before calling OpenAI
- Use recording ID + operation type as key

### Database Storage

**Store:**
- Raw transcript (full text)
- Segments with labels (Announcements, Sharing, Sermon)
- Summaries per section
- Bullet points (Sermon only)
- Member-ready message (optional)
- Processing status (pending, processing, completed, failed)

---

## Code Examples

See implementation files in the codebase.

