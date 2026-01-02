# Local Development Setup

Run the app locally for testing before pushing to GitHub/Vercel.

## Quick Start

### 1. Create Environment File

Create a `.env.local` file in the root directory with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Get these from Supabase:**
- Go to https://app.supabase.com
- Select your project → **Settings** → **API**
- Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- Copy **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Install Dependencies (if needed)

```bash
npm install
```

### 3. Start Local Server

```bash
npm run dev
```

The app will be available at: **http://localhost:3000**

## Development Workflow

1. **Make changes** → Edit code in your IDE
2. **Test locally** → App auto-reloads at `http://localhost:3000`
3. **Iterate** → Fix issues locally
4. **Commit & push** → Only push when ready to deploy

## Notes

- `.env.local` is gitignored (won't be committed)
- Changes auto-reload (hot reload)
- Use the same Supabase project as production, or create a test project
