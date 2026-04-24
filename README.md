# Madison88 Budget Management System - Netlify Deployment

A full-stack expense request and approval system deployed entirely on Netlify with glassmorphism UI design.

## 🚀 **Single-Platform Deployment**

This version is configured for **complete Netlify deployment**:
- **Frontend**: Static React app hosted on Netlify
- **Backend**: Serverless functions (Netlify Functions)
- **Database**: Supabase (PostgreSQL)
- **Everything in one Netlify site!**

## Features

- **Role-Based Access Control**: Employee, Supervisor, Accounting, Admin roles
- **Expense Workflow**: Submit → Supervisor Review → Accounting Approval → Release
- **Real-time Tracking**: Status stepper and audit timeline
- **Reports**: PDF/Excel export with filtering
- **Glassmorphism UI**: Modern, user-friendly design
- **Email Notifications**: Automated alerts for approvals/rejections
- **Budget Management**: Department budgets with automatic deductions

## Tech Stack

- **Frontend**: React + TypeScript + TailwindCSS + React Router
- **Backend**: Netlify Functions (Node.js)
- **Database**: Supabase (PostgreSQL)
- **Auth**: JWT with RBAC
- **UI**: Glassmorphism design with backdrop blur effects

## Quick Deploy Steps

### 1. **Install Netlify CLI**
```bash
npm install -g netlify-cli
netlify login
```

### 2. **Deploy to Netlify**
```bash
# From the project root directory
netlify init
netlify deploy --prod
```

### 3. **Set Environment Variables**
In your Netlify dashboard (Site settings > Environment variables):
```
SUPABASE_URL=https://hjjpqwzmrnjquneuppeb.supabase.co
SUPABASE_ANON_KEY=sb_publishable_4OT_XzItsdRNe8Jtm43nGg_-gT8fLru
JWT_SECRET=your_secure_jwt_secret_here
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_brevo_smtp_login
SMTP_PASS=your_brevo_smtp_key
EMAIL_FROM=no-reply@yourdomain.com
APP_URL=https://your-site.netlify.app
```

> For seeding the database locally, also set the Supabase service role key in `backend/.env` or root `.env`:
> `SUPABASE_SERVICE_ROLE=your_service_role_key`

### 4. **Setup Database**
Go to your Supabase dashboard and run:
1. **Schema**: Execute `docs/schema.sql`
2. **Sample Data**: Execute `docs/seed.sql`

If your database is already running and only needs forgot-password support, execute `docs/add-password-reset-tokens.sql`.

If your hosted Supabase database is already running and you want the accounting-ready workflow additions, execute `docs/add-accounting-workflow.sql`.

If your hosted Supabase database is already running and you want year-aware ticket routing plus fiscal-year request storage, execute `docs/add-request-fiscal-year.sql`.

If you want to fully retire older department fiscal years and move related users/tickets into the latest configured fiscal year, execute `docs/retire-old-fiscal-years.sql`.

Production note: this project is designed to connect to a hosted Supabase database through `SUPABASE_URL`. In production, the backend and Netlify functions now reject `localhost` or `127.0.0.1` database URLs.

### 4.5 **Local seed helper**
If Row-Level Security is enabled, the anon key cannot insert data. Use the local seed helper after you set `SUPABASE_SERVICE_ROLE`:
```bash
npm run seed:supabase
```
This helper inserts departments and the default users:
- `john.employee@madison88.com / password123`
- `jane.supervisor@madison88.com / password123`
- `bob.accounting@madison88.com / password123`
- `alice.admin@madison88.com / password123`

### 5. **Test the Application**
Your site will be live! Test with these accounts:
- **Employee**: john.employee@madison88.com / password123
- **Supervisor**: jane.supervisor@madison88.com / password123
- **Accounting**: bob.accounting@madison88.com / password123

## API Endpoints (Netlify Functions)

### Auth
- `POST /.netlify/functions/auth-login` - User login
- `GET /.netlify/functions/auth-me` - Get current user

### Requests
- `GET /.netlify/functions/requests` - List requests (filtered by role)
- `POST /.netlify/functions/requests` - Submit new request
- `PATCH /.netlify/functions/requests/{id}/approve` - Approve request
- `PATCH /.netlify/functions/requests/{id}/reject` - Reject request
- `GET /.netlify/functions/requests-timeline/{id}` - Get audit trail

### Departments
- `GET /.netlify/functions/departments` - List departments

### Expenses
- `GET /.netlify/functions/expenses` - List direct expenses
- `POST /.netlify/functions/expenses` - Log direct expense

### Reports
- `GET /.netlify/functions/reports-summary` - Summary report
- `GET /.netlify/functions/reports-requests` - Detailed requests report

## User Roles & Permissions

- **Employee**: Submit requests, track own requests
- **Supervisor**: Approve/reject team requests, log direct expenses
- **Accounting**: Final approval, budget checks, **manage department budgets**
- **Admin**: Manage users, set department budgets, create departments

## Departments

The system includes the following departments:
- **m88IT**: Information Technology
- **m88Purchasing**: Procurement and Purchasing
- **m88Planning**: Strategic Planning
- **m88logistics**: Logistics and Supply Chain
- **m88HR**: Human Resources
- **m88accounting**: Accounting and Finance

## Business Rules

- Employees can only view their own requests
- Supervisors can only approve requests from their department
- Budget deduction happens only after accounting approval
- All actions are logged in the audit trail
- Petty cash is separate from main department budget

## Glassmorphism Design

The UI features:
- Gradient backgrounds (blue → purple → pink)
- Backdrop blur effects on cards and inputs
- Semi-transparent white overlays with subtle borders
- Smooth transitions and hover effects
- Responsive design for mobile and desktop

## Development Notes

- All monetary values stored as decimals (supports cents)
- Database transactions ensure budget integrity
- JWT tokens expire in 1 hour
- Email notifications sent on approval/rejection through Brevo SMTP
- PDF/Excel reports generated server-side via Netlify Functions

## Test Accounts

After running the seed data, you can login with:
- **Employee**: john.employee@madison88.com / password123 (m88IT)
- **Supervisor**: jane.supervisor@madison88.com / password123 (m88IT)
- **Accounting**: bob.accounting@madison88.com / password123 (m88accounting) - **Can manage budgets**
- **Admin**: alice.admin@madison88.com / password123 (m88accounting)

## 🎉 **Ready for Production!**

The entire system is now configured for single-platform Netlify deployment. No need for separate backend hosting - everything runs on Netlify! 🚀
