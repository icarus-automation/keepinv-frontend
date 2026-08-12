# Production Deployment Runbook

This runbook documents the safe deployment procedure for deploying the **Lugaw Juan V2 features** (Statutory Senior/PWD discounts, Fixed daily expenses, Cup of Joy fixes, and End-of-Day reports) to production.

---

## 1. Safety Principles & Hard Constraints

- **LIVE Production Database**: Production carries real trading data.
- **NO `prisma db push` / NO `prisma migrate reset`**: Destructive operations are strictly forbidden.
- **Additive Migrations Only**: All database modifications are purely additive (new columns with defaults or nullable, new `recurring_expenses` table with RLS tenant isolation).
- **Handwritten RLS Policy**: The migration file `20260812202200_add_discounts_and_recurring_expenses` includes handwritten PostgreSQL Row-Level Security policies for multi-tenant isolation.

---

## 2. Pre-Deployment Steps (Backup)

Before applying any database migration, take a full database snapshot.

```bash
# Set your production database URL
export DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Take compressed SQL backup with timestamp
pg_dump "$DATABASE_URL" -F c -b -v -f "pre_v2_deploy_$(date +%Y%m%d_%H%M%S).dump"
```

---

## 3. Database Migration Deployment

Deploy the pending additive migration using `prisma migrate deploy`:

```bash
cd asset-wise-backend

# Validate database connection and apply pending migrations safely
bunx prisma migrate deploy

# Regenerate Prisma Client
bunx prisma generate
```

---

## 4. Backend Service Deployment

```bash
cd asset-wise-backend

# Install dependencies if updated
bun install --frozen-lockfile

# Build NestJS application
bun run build

# Restart systemd service / PM2 process
pm2 restart asset-wise-backend # or systemctl restart asset-wise-backend
```

---

## 5. Frontend Service Deployment

```bash
cd asset-wise-frontend

# Install dependencies if updated
bun install --frozen-lockfile

# Production build
bun run build

# Deploy assets / restart web server (Nginx / PM2 / Caddy)
pm2 restart asset-wise-frontend
```

---

## 6. Rollback / Emergency Recovery Plan

If an unexpected critical issue occurs:

1. **Backend & Frontend Rollback**: Revert git branch commit:
   ```bash
   git checkout PREVIOUS_TAG
   pm2 restart asset-wise-backend
   pm2 restart asset-wise-frontend
   ```

2. **Database Rollback**:
   Because migration `20260812202200_add_discounts_and_recurring_expenses` only adds new tables (`recurring_expenses`) and nullable/default columns (`discountType`, `discountRate`, etc.), existing code will continue running safely without removing the migration.
   If full DB restore is required:
   ```bash
   pg_restore --clean --if-exists -d "$DATABASE_URL" "pre_v2_deploy_TIMESTAMP.dump"
   ```
