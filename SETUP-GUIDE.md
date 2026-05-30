# AuditPro – Quick Start

## Prerequisites
- Node.js 20+
- A Supabase project

## 1) Install dependencies
```bash
npm install
```

## 2) Configure environment
- Copy [.env.example](.env.example) → `.env`
- Fill at least:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY` (or set `SUPABASE_SERVICE_ROLE_KEY` for server-side production use)
  - `JWT_SECRET`
  - `APP_URL`

## 3) Create the database tables
- In Supabase Dashboard → SQL Editor
- Run the SQL in [supabase-schema.sql](supabase-schema.sql)

## 4) Start the app
```bash
npm start
```

Open `http://localhost:3000`.

## Optional integrations
- Payments (Razorpay): set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- Email (SMTP): set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (required in production)
- PageSpeed Insights: set `PAGESPEED_API_KEY`
- Google Custom Search (keyword checker): set `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`
