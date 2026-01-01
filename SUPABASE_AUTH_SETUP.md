# Supabase Authentication URL Configuration

## Issue: Email Confirmation Cannot Connect to Server

When you receive an email confirmation link but it says "cannot connect to the server", this is because Supabase doesn't know where to redirect users after email confirmation.

## Solution: Configure URLs in Supabase Dashboard

### Step 1: Set the Site URL

1. Go to your **Supabase Dashboard**
2. Select your project
3. Navigate to **Authentication** → **URL Configuration** (or **Settings** → **Auth**)
4. Find the **Site URL** field
5. Set it to your Vercel deployment URL:
   ```
   https://audivine.vercel.app
   ```
6. Click **Save**

### Step 2: Add Redirect URLs

In the same **URL Configuration** section:

1. Find the **Redirect URLs** field (or **Redirect URL allowlist**)
2. Add the following URLs (one per line):
   ```
   https://audivine.vercel.app/**
   https://audivine.vercel.app/login
   http://localhost:3000/**
   http://localhost:3000/login
   ```
   
   The `**` wildcard allows any path under that domain (useful for catch-all redirects).

3. Click **Save**

### Step 3: Verify Email Template (Optional)

1. Go to **Authentication** → **Email Templates**
2. Check the **Confirm signup** template
3. Make sure it includes `{{ .ConfirmationURL }}` in the template
4. The default template should work, but you can customize the email content here

## What This Does

- **Site URL**: This is the default redirect URL after email confirmation. Supabase will redirect users here after they click the confirmation link in their email.
- **Redirect URLs**: This is a whitelist of allowed redirect URLs. Any redirect URL used in your app (including email confirmations) must be in this list.

## After Configuration

1. **Try signing up again** with a new email (or resend confirmation to an existing user)
2. **Click the confirmation link** in the email
3. You should be redirected to `https://audivine.vercel.app` (or your login page)
4. You can then sign in with your confirmed account

## Note

If email confirmation is enabled in Supabase, users won't be able to sign in until they confirm their email. If you want to disable email confirmation for testing:

1. Go to **Authentication** → **Providers** → **Email**
2. Toggle off **"Confirm email"**
3. Users will be automatically signed in after signup (no email confirmation needed)

