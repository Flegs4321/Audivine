# GitHub Setup Instructions

## Repository is initialized ✅

Git has been initialized and an initial commit has been created.

## Connect to GitHub

### Option 1: Create a New Repository on GitHub (Recommended)

1. **Go to GitHub**: Visit [https://github.com/new](https://github.com/new)
   - If you're not logged in, sign in to your GitHub account

2. **Create a new repository**:
   - **Repository name**: Choose a name (e.g., `devsc-recorder`, `audivine-recorder`)
   - **Description**: (Optional) "Next.js audio recorder with live transcription and Supabase storage"
   - **Visibility**: Choose **Public** or **Private**
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
   - Click **Create repository**

3. **Connect your local repository**:
   
   After creating the repository, GitHub will show you commands. Use these:

   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repository name.

### Option 2: Using SSH (if you have SSH keys set up)

If you prefer SSH instead of HTTPS:

```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## Verify Connection

After pushing, verify the connection:

```bash
git remote -v
```

You should see:
```
origin  https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git (fetch)
origin  https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git (push)
```

## Important Notes

⚠️ **Security**: 
- Your `.env.local` file is already in `.gitignore` and will NOT be committed
- Never commit API keys or secrets
- The `.gitignore` file is configured to exclude:
  - Environment variables (`.env.local`, `.env`)
  - `node_modules/`
  - Build files (`.next/`)
  - Debug logs (`.cursor/debug.log`)

## Future Commits

After the initial setup, you can commit and push changes like this:

```bash
git add .
git commit -m "Your commit message"
git push
```

## Troubleshooting

### If you get authentication errors:
- For HTTPS: GitHub may prompt for credentials. You can use a Personal Access Token instead of password
- For SSH: Make sure you have SSH keys set up in your GitHub account

### To create a Personal Access Token:
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token (classic)
3. Select scopes: `repo` (full control of private repositories)
4. Copy the token and use it as your password when pushing

