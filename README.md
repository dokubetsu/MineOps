# MineOps — Mine Logistics & Workforce Management

A mobile-first full-stack PWA web application designed to digitize manual mine registers, trip sheets, cash books, attendance rosters, payroll, and stakeholder revenue sharing calculations.

---

## 🛠️ Architecture & Technology Stack

| Component | Technology | Purpose / Role |
|---|---|---|
| **Frontend** | Next.js 16 (App Router) + TypeScript + CSS Modules | Mobile-first responsive UI, PWA features, offline readiness |
| **Backend** | FastAPI + Uvicorn + Pydantic | REST API, payroll and advanced calculations |
| **Database** | PostgreSQL (via Supabase) | Persistent storage, relational constraints |
| **Auth** | Supabase Auth | Session tracking and secure JWT-based verification |
| **Storage** | Supabase Storage | Image buckets for trip slips and worker photo evidence |
| **Styling** | Vanilla CSS (Dark & Light modes supported) | Sleek, modern theme with native UI elements |

---

## 📂 Project Structure

```
├── backend/               # FastAPI Python application
│   ├── app/
│   │   ├── routers/       # Endpoints (trips, payroll, cash book, etc.)
│   │   ├── config.py      # App configurations
│   │   ├── database.py    # Supabase connection
│   │   └── models.py      # Pydantic schemas
│   ├── tests/             # Pytest backend tests
│   └── main.py            # API entry point
│
├── frontend/              # Next.js 16 React application
│   ├── src/
│   │   ├── app/           # App router page folders
│   │   └── lib/           # Supabase connection, auth context, theme context
│   ├── vercel.json        # Vercel deployment configurations
│   └── package.json       # Node dependencies and scripts
│
└── .github/               # CI/CD Workflows
    └── workflows/ci.yml   # GitHub Actions validation check
```

---

## 🔑 Seeded Login Credentials

| User Role | Email | Password | Site Access |
|---|---|---|---|
| **Admin** | `admin@mineops.in` | `MineOps@2026` | Full Access (All Sites) |
| **Site Manager** | `manager@mineops.in` | `Manager@2026` | Scoped to **Madha Mines** operations |
| **Stakeholder** (Murali) | `murali@mineops.in` | `Murali@2026` | Read-only **Madha Mines** revenue dashboard (50% share) |

---

## 🏗️ Getting Started

### 1. Database Setup
Ensure that the Supabase SQL database schema is initialized. Five database migrations have been successfully applied covering:
1. **Master Tables**: `sites`, `transport_contractors`, `vehicles`, `drivers`, `employees`.
2. **Operations**: `trips`, `cash_books`, `cash_entries` (with 16 category triggers).
3. **Workforce**: `attendance`, `leave_applications`, `payroll_runs` + `payroll_lines`.
4. **Access Rights**: `user_roles`, `stakeholder_site_access`, and views like `stakeholder_daily_summary`.
5. **Storage buckets**: `trip-photos` and `attendance-photos` buckets for evidence files.

### 2. Run the Frontend (Next.js)
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Copy the environment variables template and configure your values:
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

### 3. Run the Backend (FastAPI)
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Set up a Python virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: .\venv\Scripts\activate
   ```
3. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the server:
   ```bash
   uvicorn main:app --reload --port 8000
   # → Documentation viewable at http://localhost:8000/docs
   ```

---

## 🧪 Running Tests

### Frontend Checks
Run linter and TypeScript compiler validation:
```bash
cd frontend
npm run test
```

### Backend Tests
Execute Python tests using `pytest`:
```bash
cd backend
pytest tests/ -v
```

---

## 🚀 CI/CD & Deployments

- **CI/CD Checks**: Run automatically via GitHub Actions on push or pull request to the `main` branch. Checks type safety, linter configurations, Next.js build compilation, and backend pytest suits.
- **Frontend Hosting**: Optimized to deploy seamlessly to **Vercel** out-of-the-box (using Root Directory `frontend` inside the Vercel Dashboard).
- **Backend Hosting**: Can be hosted on platforms like Render, Railway, or AWS ECS.