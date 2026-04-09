# Sonlight Chapel Bulletin Generator

Paste your raw Sunday service notes → AI organizes them → get a formatted `.docx` bulletin.

**No npm install needed.** Node.js 18+ and an Anthropic API key.

## Quick start

### 1. Environment variables

The script loads **`../.env.local`** (repo root) if present, then **`bulletin-final/.env`**.

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API |
| `NEXT_PUBLIC_SUPABASE_URL` | For Supabase modes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For Supabase modes | REST auth (local machine only; **never commit**) |
| `SUPABASE_USER_ID` | No | If set, `node generate.js` picks the **latest transcript among this user’s recordings** |

Get an Anthropic key at: https://console.anthropic.com/

### Member summary → this template (no second AI)

If you already have the **member summary** from the recorder app and want it mapped into **`template/template.docx`** without sending text to Claude again:

1. In the app, open **Sermon Summary for Members** and click **Sonlight bulletin (.docx)** — it uses the same mapping as below.
2. Or from the **repo root** (requires `npm install` once for `tsx`):

```bash
npm run bulletin:from-summary -- bulletin-final/my-summary.txt
```

Output goes to `bulletin-final/output/SundayBulletin_YYYY-M-D.docx` (or pass a second path for the file). Section headings in your summary (Announcements, Upcoming Events, etc.) are parsed the same way as **Export to Word** in the app. Fixed schedule lines (This Evening, Wednesday Eve, …) are not extracted from free-form summaries and stay **N/A** unless you use `generate.js` with Claude + transcript.

### 2. Generate a bulletin (Claude + transcript or notes file)

**From a text file (no Supabase):**

```bash
cd bulletin-final
node generate.js notes-example.txt
```

**Latest transcript in Supabase** (non-empty `transcript_chunks`, newest by `created_at`):

```bash
node generate.js
```

**Specific recording** (copy the recording id from your app or Supabase):

```bash
node generate.js 550e8400-e29b-41d4-a716-446655440000
# or
node generate.js --id=550e8400-e29b-41d4-a716-446655440000
```

**Help:**

```bash
node generate.js -h
```

### 3. Output

The `.docx` is written under `bulletin-final/output/`. Open it in Word.

## Project structure

```
bulletin-final/
├── generate.js          ← Generator (Node built-ins only)
├── resolve-template-path.js  ← Finds template.docx or TEMPLATE.docx under template/
├── template/
│   └── template.docx    ← Master template (or TEMPLATE.docx on Windows); placeholders {{DATE}}, {{EVENT_ITEM}}, …
├── output/              ← Generated bulletins
├── notes-example.txt    ← Sample notes for file mode
├── .cursorrules         ← Cursor guidance for this folder
└── README.md
```

## Template placeholders

Keep placeholders exactly as in the template: `{{DATE}}`, `{{ANNOUNCEMENT_ITEM}}`, `{{EVENT_ITEM}}`, etc. See `.cursorrules` for the full list.

## Cost

Roughly **$0.01–0.02** per bulletin (one Claude API call).

## Security note

Supabase access uses the **service role** key so the CLI can read rows regardless of RLS. Treat `.env.local` like a secret; do not commit it or share the service role key.
