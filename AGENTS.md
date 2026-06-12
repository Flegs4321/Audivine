# Audivine (devsc-recorder)

Next.js 16 app for recording sermons, live transcription, AI summaries, and bulletin generation. Backend is Supabase (auth, Postgres, storage).

## Stack

- Next.js App Router (`app/`), React 19, TypeScript, Tailwind CSS
- Supabase client in `lib/supabase/`
- API routes under `app/api/`
- Tests: Vitest (`npm test`)

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm test
```

## Environment variables

Copy from `.env.local` (not committed). Required for most features:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only routes, uploads, bulletin template)
- `OPENAI_API_KEY` (transcription, summarization, segment detection)
- `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)
- `NEXT_PUBLIC_APP_URL` (optional, defaults to `http://localhost:3000`)

Optional:

- `ANTHROPIC_API_KEY` (bulletin-final scripts)
- `NEXT_PUBLIC_SPEECH_ON_DEVICE` (`"true"` for on-device browser speech)

## Conventions

- Keep changes focused; match existing patterns in nearby files.
- Do not commit secrets, `.env.local`, or `node_modules/`.
- Prefer existing helpers in `lib/` over duplicating Supabase or OpenAI logic.
- API routes should use `lib/supabase/server-auth.ts` for authenticated requests where applicable.

## Key areas

- `app/recorder/` — recording UI and transcription providers
- `app/api/sermons/` — upload, transcribe, summarize
- `app/api/recordings/` — segments, export, transcript chunks
- `lib/summarizer/` — sermon summary generation
- `supabase/` — migrations and SQL setup docs
