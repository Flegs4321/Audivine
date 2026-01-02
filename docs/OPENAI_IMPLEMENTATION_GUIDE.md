# OpenAI Implementation Guide

## Overview

This guide covers the complete implementation of OpenAI-powered transcription and analysis for church service recordings.

## Architecture

```
┌─────────────────┐
│  Client Browser │
│  (Record Audio) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ /api/sermons/upload      │
│ - Store in Supabase      │
│ - Return recording ID    │
└────────┬─────────────────┘
         │
         ▼
┌─────────────────────────┐
│ /api/sermons/transcribe  │
│ - Download audio         │
│ - Call OpenAI Whisper    │
│ - Store transcript       │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ /api/sermons/analyze-with-   │
│   openai                      │
│ - Segment transcript         │
│ - Generate summaries         │
│ - Store segments             │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Review Page             │
│ - Display sections      │
│ - Edit summaries        │
│ - Generate member msg   │
└─────────────────────────┘
```

## API Routes

### 1. `/api/sermons/transcribe`

**Purpose:** Transcribe audio using OpenAI Whisper API

**Request:**
```typescript
POST /api/sermons/transcribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "recordingId": "uuid",
  "audioUrl": "optional-url" // If audio already uploaded
}
```

**Response:**
```typescript
{
  "success": true,
  "transcript": "Full transcript text...",
  "chunks": [
    {
      "text": "Segment text",
      "timestampMs": 1234,
      "isFinal": true
    }
  ],
  "recordingId": "uuid"
}
```

**Features:**
- ✅ Idempotency (checks if already transcribed)
- ✅ Retry logic with exponential backoff
- ✅ File size validation (25MB limit)
- ✅ Stores transcript in database

**Cost:** ~$0.003-0.006 per minute

---

### 2. `/api/sermons/analyze-with-openai`

**Purpose:** Segment transcript and generate summaries using OpenAI

**Request:**
```typescript
POST /api/sermons/analyze-with-openai
Authorization: Bearer <token>
Content-Type: application/json

{
  "recordingId": "uuid",
  "transcript": "optional-full-text" // If not provided, fetched from DB
}
```

**Response:**
```typescript
{
  "success": true,
  "sections": {
    "announcements": {
      "summary": "2-4 sentence summary",
      "bullets": ["bullet 1", "bullet 2"]
    },
    "sharing": {
      "summary": "2-4 sentence summary",
      "bullets": ["bullet 1", "bullet 2"]
    },
    "sermon": {
      "summary": "2-4 sentence summary",
      "bullets": ["bullet 1", "bullet 2"],
      "key_points": ["key point 1", "key point 2"]
    }
  },
  "recordingId": "uuid"
}
```

**Features:**
- ✅ Structured JSON output
- ✅ Retry logic for rate limits
- ✅ Stores segments in database
- ✅ Validates response format

**Cost:** ~$0.003 per service

---

## Client-Side Integration

### Example: Trigger Transcription After Upload

```typescript
// After uploading recording
const handleRecordingUploaded = async (recordingId: string) => {
  try {
    // Step 1: Transcribe
    const transcribeResponse = await fetch('/api/sermons/transcribe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordingId }),
    });

    if (!transcribeResponse.ok) {
      throw new Error('Transcription failed');
    }

    const { transcript } = await transcribeResponse.json();
    console.log('Transcript:', transcript);

    // Step 2: Analyze
    const analyzeResponse = await fetch('/api/sermons/analyze-with-openai', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordingId }),
    });

    if (!analyzeResponse.ok) {
      throw new Error('Analysis failed');
    }

    const { sections } = await analyzeResponse.json();
    console.log('Sections:', sections);

    // Navigate to review page
    router.push(`/recorder/review?id=${recordingId}`);
  } catch (error) {
    console.error('Error:', error);
  }
};
```

---

## Audio Format Recommendations

### Current Implementation: WebM/Opus
- ✅ Browser-native (MediaRecorder API)
- ✅ Good compression (~1-2MB per minute)
- ✅ Good quality at lower bitrates
- ✅ Works with OpenAI Whisper API

### File Size Estimates
- **60-minute service**: ~60-120MB (WebM/Opus)
- **25MB limit**: Need chunking for services >20-25 minutes

### Chunking Strategy (Future Enhancement)

For files >25MB:
1. Split audio into 20-minute chunks
2. Transcribe each chunk separately
3. Merge transcripts maintaining timestamps
4. Process merged transcript for analysis

---

## Error Handling & Retry Logic

### Retry Configuration
```typescript
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
```

### Retry Triggers
- ✅ HTTP 429 (Rate Limit)
- ✅ HTTP 500+ (Server Errors)
- ✅ Network timeouts

### Idempotency
- Uses `recordingId` as key
- Checks database before processing
- Returns existing results if already processed

---

## Database Storage

### Transcript Storage
```typescript
// recordings table
{
  transcript_chunks: [
    {
      text: "Segment text",
      timestampMs: 1234,
      isFinal: true
    }
  ]
}
```

### Segments Storage
```typescript
// recordings table
{
  segments: [
    {
      label: "Announcements" | "Sharing" | "Sermon",
      startMs: 0,
      endMs: null,
      text: "Section transcript",
      summary: "2-4 sentence summary",
      bullets: ["bullet 1", "bullet 2"],
      key_points: ["key point 1"] // Sermon only
    }
  ]
}
```

---

## Cost Optimization Tips

1. **Cache Transcripts**: Check DB before calling OpenAI
2. **Batch Processing**: Process multiple recordings together (future)
3. **Model Selection**: Use `gpt-4o-mini` for summarization (cheaper)
4. **Token Limits**: Truncate transcripts to 16K tokens for analysis
5. **Retry Logic**: Prevents wasted API calls on transient errors

---

## Environment Variables

Required in `.env.local` and Vercel:
```bash
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## Testing

### Test Transcription
```bash
curl -X POST http://localhost:3000/api/sermons/transcribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"recordingId": "test-id"}'
```

### Test Analysis
```bash
curl -X POST http://localhost:3000/api/sermons/analyze-with-openai \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"recordingId": "test-id"}'
```

---

## Next Steps

1. ✅ Transcription API - **Implemented**
2. ✅ Analysis API - **Implemented**
3. ⏳ Client integration - **Add to upload flow**
4. ⏳ Chunking for large files - **Future enhancement**
5. ⏳ Background job processing - **Future enhancement**
6. ⏳ Email sending - **Future enhancement**

