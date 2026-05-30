# AuditPro - Website SEO & Performance Audit SaaS

A production-ready SaaS application for website SEO and performance audits. Users can enter a URL and receive comprehensive audit reports with SEO scores, recommendations, and actionable insights.

## Features

- **User Authentication**: JWT-based authentication with secure password hashing
- **SEO Audits**: Automated analysis of title tags, meta descriptions, H1 tags, image alt tags, HTTPS, and more
- **Free & Pro Plans**: Free plan includes 2 audits/month, Pro plan offers unlimited audits
- **Payment Integration**: Razorpay integration for seamless Pro plan upgrades
- **Dashboard**: View audit history and manage account
- **Responsive UI**: Modern, clean interface built with Tailwind CSS

## Tech Stack

### Backend
- Node.js 20+
- Express.js
- **Supabase (PostgreSQL)** - Database
- JWT Authentication
- bcryptjs for password hashing
- Axios for HTTP requests
- Cheerio for HTML parsing
- Razorpay for payments

### Frontend
- EJS templating engine
- Tailwind CSS (via CDN)
- Responsive design

### Security & Middleware
- Helmet for security headers
- CORS configuration
- Rate limiting
- Input validation with Joi
- Morgan for logging

## Project Structure

```
├── config/
│   └── db.js                      # Supabase connection (with in-memory fallback)
├── controllers/
│   ├── authController.js          # Authentication (register/login/logout)
│   ├── auditController.js         # SEO audit operations, PDF, email, compare, export
│   ├── localBusinessController.js # Local business / restaurant audit
│   ├── pageController.js          # Page rendering
│   ├── paymentController.js       # Razorpay payment integration
│   └── scheduledAuditController.js # Scheduled audits
├── backend/
│   ├── middleware/
│   │   ├── auth.js                # JWT authentication middleware
│   │   ├── errorHandler.js        # Global error handler
│   │   ├── rateLimiter.js         # Rate limiting configs
│   │   └── validate.js            # Input validation with Joi
│   ├── models/
│   │   ├── User.js                # User model (Supabase)
│   │   ├── Audit.js               # Audit model (Supabase)
│   │   └── ScheduledAudit.js       # Scheduled audit model (Supabase)
│   ├── routes/
│   │   └── index.js               # All routes
│   ├── utils/
│   │   ├── auditEngine.js         # SEO analysis engine (1,000+ lines)
│   │   ├── localBusinessEngine.js # Restaurant / local business audit engine
│   │   └── emailConfig.js         # Nodemailer transporter config
│   ├── app.js                     # Express app configuration
│   ├── server.js                  # Server entry point
│   └── supabase-schema.sql        # Database schema
├── frontend/
│   ├── views/
│   │   ├── partials/              # Header & footer
│   │   ├── landing.ejs
│   │   ├── login.ejs / register.ejs
│   │   ├── dashboard.ejs
│   │   ├── audit.ejs / audit-result.ejs
│   │   ├── local-audit.ejs / local-audit-result.ejs
│   │   ├── compare-form.ejs / compare.ejs
│   │   ├── pricing.ejs
│   │   └── error.ejs
│   ├── public/                    # Static assets (CSS, favicon)
│   ├── src/
│   │   └── input.css              # Tailwind CSS source
│   └── tailwind.config.js         # Tailwind CSS configuration
├── .env.example                   # Environment variable template
├── SUPABASE-SETUP.md              # Supabase setup instructions
├── SETUP-GUIDE.md                 # Quick start guide
├── supabase-schema.sql            # Database schema
└── package.json
```

## Setup Instructions

### 1. Prerequisites

- Node.js 20 or higher
- Supabase account (free tier available)
- Razorpay account (for payments)

### 2. Clone and Install

```bash
# Install dependencies
npm install
```

### 3. Environment Variables

Update `.env` with your values:

**Required variables:**

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (server-side only)
- `JWT_SECRET`: Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `APP_URL`: Your app URL (http://localhost:3000 for dev)

**RLS note:** If you run the provided RLS policies, set `JWT_SECRET` to your Supabase project's JWT secret so user tokens can be used to enforce RLS.

**Payments (optional):**

- `RAZORPAY_KEY_ID`: From Razorpay dashboard
- `RAZORPAY_KEY_SECRET`: From Razorpay dashboard
- `RAZORPAY_WEBHOOK_SECRET`: From Razorpay webhook settings

### 4. Supabase Setup

📖 **See [SUPABASE-SETUP.md](SUPABASE-SETUP.md) for detailed instructions**

Quick steps:
1. Create a free Supabase account at [app.supabase.com](https://app.supabase.com)
2. Create a new project
3. Run the SQL from `supabase-schema.sql` in the SQL Editor
4. Get your Project URL and anon key from Settings → API
5. Add them to `.env`

### 5. Razorpay Setup

1. Sign up at [Razorpay](https://razorpay.com/)
2. Go to Dashboard → Settings → API Keys
3. Generate test keys (or live keys for production)
4. Add to `.env`:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
5. Set up webhook:
   - Go to Settings → Webhooks
   - Add webhook URL: `https://yourdomain.com/payment/webhook`
   - Select event: `payment.captured`
   - Copy webhook secret to `RAZORPAY_WEBHOOK_SECRET`

### 6. Run the Application

```bash
# Development
npm start

# Or with nodemon (if installed)
npm run dev
```

The app will run on `http://localhost:3000`

## Usage

1. **Register**: Create a free account
2. **Run Audit**: Enter a website URL and get instant SEO analysis
3. **View Reports**: Access audit history from dashboard
4. **Upgrade**: Upgrade to Pro for unlimited audits

## API Endpoints

### Public
- `GET /` - Landing page
- `GET /pricing` - Pricing page
- `GET /login` - Login page
- `GET /register` - Register page
- `POST /register` - Create account
- `POST /login` - Authenticate
- `GET /logout` - Logout

### Protected (requires authentication)
- `GET /dashboard` - User dashboard
- `GET /audit` - Audit form
- `POST /audit` - Run website SEO audit
- `GET /audit/:id` - View audit result
- `GET /audit/:id/pdf` - Download PDF report
- `POST /audit/:id/email` - Email PDF report
- `GET /api/audits` - List user audits (JSON)
- `GET /compare` - Competitor comparison form
- `POST /compare` - Run competitor comparison
- `GET /backup` - Export audit history (JSON/CSV)
- `GET /local-audit` - Local business audit form
- `POST /local-audit` - Run local business audit
- `GET /local-audit/:id` - View local audit result
- `GET /payment/create-order` - Create Razorpay order
- `POST /payment/verify` - Verify payment

### Webhook
- `POST /payment/webhook` - Razorpay webhook (no auth)

## Deployment Guide (Render)

### 1. Prepare for Production

1. Update `.env` with production values:
   - `NODE_ENV=production`
   - `APP_URL=https://yourdomain.com`
   - Production Supabase URL and key
   - Production Razorpay keys

2. Update Razorpay webhook URL to production URL

### 2. Deploy to Render

1. Push code to GitHub
2. Go to [Render](https://render.com/)
3. Create new Web Service
4. Connect GitHub repository
5. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
6. Add environment variables from `.env`
7. Deploy

### 3. Post-Deployment

1. Update Razorpay webhook URL to your Render URL
2. Test payment flow
3. Monitor logs for errors

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET` (32+ characters)
- [ ] Configure production Supabase project
- [ ] Set up Razorpay production keys
- [ ] Configure webhook URL in Razorpay
- [ ] Set `APP_URL` to production domain
- [ ] Enable HTTPS (Render provides automatically)
- [ ] Review rate limits
- [ ] Set up error monitoring (optional)
- [ ] Configure domain (optional)

## Security Features

- Password hashing with bcryptjs (12 rounds)
- JWT token-based authentication
- Helmet security headers
- Rate limiting on auth and audit endpoints
- Input validation with Joi
- CORS configuration
- Secure cookie settings in production
- SQL injection protection via parameterized queries

## Database - Supabase (PostgreSQL)

This app uses Supabase, which provides:
- ✅ Free tier: 500MB database storage
- ✅ Unlimited API requests
- ✅ Auto-generated REST APIs
- ✅ Real-time capabilities
- ✅ Web dashboard for data management
- ✅ PostgreSQL reliability and performance

See `supabase-schema.sql` for the database schema.

## Free Plan Limits

- 2 website audits per month
- 5 keywords for bulk ranking check
- Full access to local business audits
- Full access to competitor comparison

## Pro Plan Features

- Unlimited website audits
- Unlimited keyword ranking checks
- Full audit history access
- PDF download & email reports

## Troubleshooting

### Supabase Connection Issues
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`
- Check if tables are created (run `supabase-schema.sql` in Supabase SQL Editor)
- Ensure your Supabase project is active and not paused
- The app falls back to in-memory storage if Supabase is unavailable

### CORS Issues (Browser)
- Ensure your frontend origin is allowed via `APP_URL` and/or `CORS_ORIGINS` (comma-separated)
- Origin must match exactly (scheme + host + port), e.g. `http://localhost:5173`
- In development, `http://localhost:<any>` and `http://127.0.0.1:<any>` are allowed automatically

### Razorpay Payment Issues
- Verify API keys are correct
- Check webhook URL is accessible
- Ensure webhook secret matches

### Audit Fails
- Check if URL is accessible
- Verify URL format (http/https)
- Check server logs for errors

## License

MIT

## Support

For issues and questions, please open an issue in the repository.
