# Local Setup Guide

## Database Seeding

### Prerequisites
1. Supabase project created
2. Database schema applied: run `docs/schema.sql` in Supabase dashboard

### Steps

1. **Get your Supabase Service Role Key**
   - Go to Supabase dashboard → Project Settings → API
   - Copy the `service_role` (SECRET) key

2. **Add to environment**
   
   In `backend/.env` or root `.env`, add:
   ```
   SUPABASE_SERVICE_ROLE=your_service_role_key_here
   ```

3. **Run seed script**
   ```bash
   npm run seed:supabase
   ```

### Default Test Accounts

After seeding, use these credentials:

| Email | Password | Role |
|-------|----------|------|
| john.employee@madison88.com | password123 | Employee |
| jane.supervisor@madison88.com | password123 | Supervisor |
| bob.accounting@madison88.com | password123 | Accounting |
| alice.admin@madison88.com | password123 | Admin |

### Local Development

Start both backend and frontend:

```bash
# Terminal 1: Backend
node local-dev-server.js

# Terminal 2: Frontend
cd frontend && npm run dev
```

Visit `http://localhost:5173` and log in with any test account above.
