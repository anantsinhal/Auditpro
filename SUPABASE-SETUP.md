# Supabase Setup Guide for AuditPro

This application now uses **Supabase** (PostgreSQL) instead of MongoDB.

## Quick Setup Steps

### Step 1: Create Supabase Account

1. Go to [Supabase](https://app.supabase.com)
2. Sign up for a free account
3. Create a new project
   - Choose a project name (e.g., "auditpro")
   - Set a strong database password (you won't need this for the app)
   - Select a region closest to you
   - Click "Create new project"

### Step 2: Create Database Tables

1. In your Supabase project dashboard, click on **SQL Editor** in the left sidebar
2. Click **New query**
3. Copy the entire contents of `supabase-schema.sql` file (in the project root)
4. Paste it into the SQL editor
5. Click **Run** to create the tables

### Step 3: Get Your Supabase Credentials

1. In your Supabase project, go to **Settings** (gear icon) → **API**
2. Copy the following values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (under Project API keys)

### Step 4: Update Environment Variables

1. Open the `.env` file in your project root
2. Replace the placeholder values:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   ```

   (Required for server-side use):
   ```env
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```

   (Required if you enable the provided RLS policies):
   - Set `JWT_SECRET` in your app to your Supabase project's JWT secret
     (Supabase Dashboard → Settings → API → JWT Settings).

3. Save the file

### Step 5: Start the Application

```bash
npm start
```

Your application should now be running with Supabase!

## What Changed from MongoDB?

- **Database**: MongoDB → PostgreSQL (via Supabase)
- **Data Models**: Mongoose schemas → PostgreSQL tables
- **APIs**: MongoDB queries → Supabase client queries
- **IDs**: MongoDB ObjectIds (`_id`) → PostgreSQL UUIDs (`id`)

## Database Schema

### Users Table
- `id` (UUID) - Primary key
- `name` (VARCHAR)
- `email` (VARCHAR, unique)
- `password` (VARCHAR, bcrypt hashed)
- `plan` (VARCHAR) - 'free' or 'pro'
- `audit_count` (INTEGER)
- `audit_reset_month` (INTEGER)
- `created_at` (TIMESTAMP)

### Audits Table
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key to users
- `url` (TEXT)
- `seo_score` (INTEGER, 0-100)
- `results` (JSONB) - Stores audit details
- `created_at` (TIMESTAMP)

## Advantages of Supabase

✅ **Free tier**: 500MB database, unlimited API requests  
✅ **Real-time**: Built-in real-time subscriptions  
✅ **Auto APIs**: RESTful API auto-generated  
✅ **PostgreSQL**: Powerful relational database  
✅ **Dashboard**: Beautiful web interface to view/edit data  
✅ **Auth**: Built-in authentication (not used in this app yet)  
✅ **Storage**: File storage included (not used in this app yet)

## Viewing Your Data

You can view and edit your data directly in Supabase:
1. Go to **Table Editor** in your Supabase dashboard
2. Select `users` or `audits` table
3. View/add/edit/delete records with a spreadsheet-like interface

## Troubleshooting

**Error: "SUPABASE_URL and SUPABASE_ANON_KEY must be defined"**
- Make sure you've updated the `.env` file with your actual Supabase credentials

**Error: permission denied / RLS policy error**
- If you're using the anon key from the server, ensure Row Level Security (RLS) is OFF for these tables or you have policies that allow the needed operations.
- For production, prefer `SUPABASE_SERVICE_ROLE_KEY` (server-side only).

**Error: "relation 'users' does not exist"**
- Run the SQL schema from `supabase-schema.sql` in the Supabase SQL Editor

**Error: "Failed to connect to Supabase"**
- Check your internet connection
- Verify your Supabase URL and anon key are correct
- Make sure your Supabase project is active

## Need Help?

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Discord](https://discord.supabase.com)
