# Vercel Deployment Guide

This guide will walk you through deploying your Audivine app to Vercel.

## Prerequisites

- ✅ Your code is pushed to GitHub (recommended) or GitLab/Bitbucket
- ✅ You have a Vercel account (sign up at [vercel.com](https://vercel.com) if needed)
- ✅ Your Supabase project is set up
- ✅ All database migrations have been applied in Supabase

## Step 1: Push Your Code to GitHub

If you haven't already, make sure your code is pushed to GitHub:

```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

## Step 2: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard (Recommended)

1. **Go to Vercel**: Visit [vercel.com](https://vercel.com) and sign in
2. **Import Project**:
   - Click "Add New..." → "Project"
   - Import your GitHub repository
   - Select your repository from the list
3. **Configure Project**:
   - **Framework Preset**: Vercel should auto-detect "Next.js"
   - **Root Directory**: Leave as `.` (default)
   - **Build Command**: Leave as `npm run build` (default)
   - **Output Directory**: Leave as `.next` (default)
   - **Install Command**: Leave as `npm install` (default)
4. **Environment Variables**: Add these (see Step 3 below)
5. **Deploy**: Click "Deploy"

### Option B: Deploy via Vercel CLI

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

   Follow the prompts. When asked about production deployment, choose:
   - Set up and deploy? **Yes**
   - Link to existing project? **No** (for first time)
   - Project name: (use default or choose a name)
   - Directory: `.` (default)

4. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

## Step 3: Configure Environment Variables

**Critical**: You MUST add environment variables in Vercel for your app to work.

### In Vercel Dashboard:

1. Go to your project in Vercel
2. Click **Settings** → **Environment Variables**
3. Add the following variables:

#### Required Variables:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Where to find these**:
- Go to your Supabase Dashboard → Settings → API
- Copy:
  - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
  - **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

#### Optional Variables (if using OpenAI for analysis/summaries):

If you're using OpenAI for automatic section detection and summarization, you'll also need:

```
OPENAI_API_KEY=your_openai_api_key
```

**Note**: If you're using mock providers for development, you can skip this variable.

### Setting Environment Variables:

For each variable:
1. Click **Add New**
2. Enter the **Key** (e.g., `NEXT_PUBLIC_SUPABASE_URL`)
3. Enter the **Value** (your actual value)
4. Select environments: **Production**, **Preview**, and **Development** (or just Production if you prefer)
5. Click **Save**

**Important**: After adding environment variables, you need to **redeploy** your application for the changes to take effect.

## Step 4: Redeploy After Adding Environment Variables

If you added environment variables after the initial deployment:

1. Go to your project in Vercel
2. Click **Deployments** tab
3. Click the three dots (...) on the latest deployment
4. Click **Redeploy**

Or via CLI:
```bash
vercel --prod
```

## Step 5: Verify Deployment

1. **Check Build Logs**: After deployment, check the build logs to ensure there are no errors
2. **Visit Your Site**: Click the deployment URL (e.g., `your-app.vercel.app`)
3. **Test Functionality**:
   - Try signing up/logging in
   - Test recording (if you have microphone access)
   - Test uploading sermons
   - Check that data is saving to Supabase

## Step 6: Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Add your custom domain
3. Follow Vercel's instructions to configure DNS

## Troubleshooting

### Build Fails

- **Check build logs** in Vercel dashboard for specific errors
- **Verify Node.js version**: Vercel should use Node 18+ by default
- **Check for TypeScript errors**: Run `npm run build` locally first

### Environment Variables Not Working

- **Verify variable names**: They must match exactly (case-sensitive)
- **Redeploy after adding variables**: Changes require a new deployment
- **Check variable scope**: Make sure variables are added to the correct environment (Production/Preview)

### App Works Locally but Not on Vercel

- **Check environment variables**: Ensure all required variables are set in Vercel
- **Check Supabase CORS settings**: Supabase should allow requests from your Vercel domain
- **Check browser console**: Look for errors in the browser developer tools

### Authentication Issues

- **Verify Supabase URL/Key**: Double-check your environment variables in Vercel
- **Check Supabase Auth settings**: Ensure email auth is enabled
- **Check redirect URLs**: In Supabase Dashboard → Authentication → URL Configuration, add your Vercel domain to allowed redirect URLs

## Important Notes

⚠️ **Security**:
- Never commit `.env.local` files to Git (they're already in `.gitignore`)
- Use Vercel's Environment Variables feature instead
- The `NEXT_PUBLIC_` prefix makes variables available in the browser (safe for Supabase anon key)

📝 **Database Migrations**:
- Database migrations must be run manually in Supabase Dashboard
- Vercel does NOT automatically run migrations
- Go to Supabase Dashboard → SQL Editor and run your migration files

🔄 **Automatic Deployments**:
- Vercel automatically deploys on every push to `main` branch
- Preview deployments are created for pull requests
- You can disable this in Settings → Git

## Next Steps

After successful deployment:

1. ✅ Test all features on the live site
2. ✅ Monitor error logs in Vercel Dashboard
3. ✅ Set up monitoring/alerts if needed
4. ✅ Update documentation with your live URL
5. ✅ Share your deployed app! 🎉

## Support

- **Vercel Documentation**: [vercel.com/docs](https://vercel.com/docs)
- **Next.js Deployment**: [nextjs.org/docs/deployment](https://nextjs.org/docs/deployment)
- **Supabase Docs**: [supabase.com/docs](https://supabase.com/docs)

