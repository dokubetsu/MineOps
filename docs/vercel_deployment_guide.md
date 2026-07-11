# MineOps Frontend — Vercel Deployment Guide

Deploying the Next.js 16 mobile-first client to Vercel is straightforward. Follow these step-by-step instructions to get the live application online in under 2 minutes.

---

## 📋 Prerequisites

Before starting, ensure you have:
1. A **Vercel Account** (linked to your GitHub).
2. The GitHub Repository URL: `https://github.com/dokubetsu/MineOps`.
3. Your **Supabase API Keys** from the Supabase Dashboard:
   - Go to [Supabase Dashboard](https://supabase.com/dashboard) → Select your project → **Settings** (Gear Icon) → **API**.
   - Copy the **Project URL**, the **anon public key**, and the **service_role secret key**.

---

## 🚀 Step 1: Import Project in Vercel

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New** → **Project**.
2. Find the `MineOps` repository in your GitHub list and click **Import**.

---

## ⚙️ Step 2: Configure Project Settings

On the configuration page, adjust the following settings:

### 1. Root Directory (CRITICAL)
- By default, Vercel looks at the root of the repository. Because our Next.js code is in a subdirectory, click the **Edit** button next to **Root Directory** and select:
  ```
  frontend
  ```
  *(Make sure it is set to `frontend` so it builds the Next.js application).*

### 2. Framework Preset
- Vercel will automatically detect and set this to **Next.js**. Leave it as is.

### 3. Build & Development Settings
- Keep the default commands:
  - **Build Command**: `next build`
  - **Install Command**: `npm install`

---

## 🔑 Step 3: Add Environment Variables

Expand the **Environment Variables** section and add the following three keys:

| Key | Value | Purpose / Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | *Your Supabase URL* | Client-side database connectivity |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *Your Supabase Anon Key* | Client-side public operations |
| `SUPABASE_SERVICE_ROLE_KEY` | *Your Supabase Service Role Key* | Server-side secure user creation |

> [!IMPORTANT]
> The `SUPABASE_SERVICE_ROLE_KEY` is a secret key that bypasses Row Level Security (RLS). Next.js uses it only on the secure Node.js server to create users automatically without email verification. Never prefix it with `NEXT_PUBLIC_` or share it client-side.

---

## 🚢 Step 4: Deploy

1. Click the **Deploy** button.
2. Vercel will clone the repository, run type checks, compile the pages, and publish the live production build.
3. Once completed, copy the deployed project URL (e.g. `https://mine-ops.vercel.app`).

---

## 🔐 Step 5: Update Supabase Redirects

To ensure users are redirected back to the live website after entering their login credentials:
1. Go to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Authentication** → **URL Configuration**.
3. Under **Site URL**, set your primary deployment URL:
   ```
   https://your-project-name.vercel.app/
   ```
4. Under **Redirect URLs**, click **Add URL** and add your dashboard path:
   ```
   https://your-project-name.vercel.app/dashboard
   ```
5. Click **Save**.

---

> [!TIP]
> **Automatic Redeployments**: Any subsequent commits pushed to your GitHub `main` branch will automatically trigger Vercel to build and roll out updates instantly.
