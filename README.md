# MineOps — Mine Logistics & Workforce Management

A mobile-first full-stack PWA web application designed to digitize manual mine registers, trip sheets, cash books, attendance rosters, payroll, and stakeholder revenue sharing calculations.

---

## 🛠️ Architecture & Technology Stack

MineOps has transitioned to a streamlined architecture (Option A: client-to-database backend-less model) to reduce duplicate logic and technical debt:

| Component | Technology | Purpose / Role |
|---|---|---|
| **Frontend & Server Routes** | Next.js 16 (App Router) + TypeScript + CSS Modules | Mobile-first responsive UI, PWA features, offline readiness, and server routes for secure admin actions |
| **Database & Calculations** | PostgreSQL (via Supabase) | Persistent storage, relational constraints, triggers, and views |
| **Auth** | Supabase Auth | Session tracking and secure JWT-based verification |
| **Storage** | Supabase Storage | Image buckets for trip slips and worker photo evidence |
| **Styling** | Vanilla CSS (Dark & Light modes supported) | Sleek, modern theme with native UI elements |

---

## 📂 Project Structure

```
├── frontend/              # Next.js 16 React application
│   ├── src/
│   │   ├── app/           # App router page folders and API route handlers
│   │   └── lib/           # Supabase connection, auth context, theme context
│   ├── vercel.json        # Vercel deployment configurations
│   └── package.json       # Node dependencies and scripts
│
└── .github/               # CI/CD Workflows
    └── workflows/ci.yml   # GitHub Actions validation check
```

---

## 🔑 Application Authentication & Users

For security, login credentials are not stored in source control. Access controls are managed dynamically:
- **Admin**: Configure an admin account via Supabase Auth and map it to `role = 'admin'` in the `user_roles` table.
- **Site Manager**: Configure accounts mapped to `role = 'site_manager'` with specific `site_id` scopes.
- **Stakeholder**: Configure read-only stakeholder accounts with specific revenue share allocations mapped via `stakeholder_site_access`.

---

## 🏗️ Getting Started

### 1. Database Setup
Ensure that the Supabase SQL database schema is initialized. Eight database migrations have been successfully applied covering:
1. **Master Tables**: `sites`, `transport_contractors`, `vehicles`, `drivers`, `employees`.
2. **Operations**: `trips`, `cash_books`, `cash_entries` (with 16 category triggers).
3. **Workforce**: `attendance`, `leave_applications`, `payroll_runs` + `payroll_lines`.
4. **Access Rights**: `user_roles`, `stakeholder_site_access`, and views like `stakeholder_daily_summary`.
5. **Storage buckets**: `trip-photos` and `attendance-photos` buckets for evidence files.
6. **Robust Triggers & Constraints**: Unique constraints, check constraints, audit triggers, and performance indexes.
7. **Storage Buckets Security**: Configuring private storage buckets and blocking delete operations on finalized payroll runs.
8. **Schema Pruning & Cascades**: Dropping dead columns/tables and enforcing referential integrity (ON DELETE CASCADE/SET NULL) constraints.

### 2. Run the Frontend (Next.js)
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Copy the environment variables template and configure your values (ensure `SUPABASE_SERVICE_ROLE_KEY` is set for server-side user provision):
   ```bash
   cp .env.example .env.local
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the local server:
   ```bash
   npm run dev
   # → Accessible on http://localhost:3000
   ```

---

## 🧪 Running Tests

### Frontend Checks
Run linter and TypeScript compiler validation:
```bash
cd frontend
npm run test
```

---

## 🚀 CI/CD & Deployments

- **CI/CD Checks**: Run automatically via GitHub Actions on push or pull request to the `main` branch.
- **Frontend Hosting**: Optimized to deploy seamlessly to **Vercel** out-of-the-box (using Root Directory `frontend` inside the Vercel Dashboard).