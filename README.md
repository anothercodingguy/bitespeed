# Bitespeed Identity Reconciliation Service

A backend service that implements **Bitespeed's Identity Reconciliation** challenge. The `POST /identify` endpoint accepts an email and/or phone number, and returns a consolidated contact identity by linking and merging related contact records.

**Stack:** Node.js · TypeScript · Express · Prisma ORM · PostgreSQL

---

## Table of Contents

- [How It Works](#how-it-works)
- [Normalization Rules](#normalization-rules)
- [Local Setup](#local-setup)
- [API Reference](#api-reference)
- [Sample curl Requests](#sample-curl-requests)
- [Prisma Commands](#prisma-commands)
- [Deploy to Render](#deploy-to-render)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)

---

## How It Works

The `/identify` endpoint performs **identity reconciliation**:

1. **No match** → Creates a new **primary** contact.
2. **Match found, new info** → Creates a **secondary** contact linked to the existing primary.
3. **Two primaries connected** → **Merges** them: the oldest (by `createdAt`) stays primary; the other becomes secondary. All linked rows are updated to point to the surviving primary.

All database writes happen inside a **Prisma interactive transaction** to prevent race conditions.

### Contact Model

| Field            | Type     | Description                                      |
|------------------|----------|--------------------------------------------------|
| `id`             | Int (PK) | Auto-incrementing primary key                    |
| `phoneNumber`    | String?  | Phone number (trimmed string)                    |
| `email`          | String?  | Email address (trimmed, lowercased)              |
| `linkedId`       | Int?     | Points to the primary contact's `id` (null for primaries) |
| `linkPrecedence` | Enum     | `"primary"` or `"secondary"`                     |
| `createdAt`      | DateTime | Row creation timestamp                           |
| `updatedAt`      | DateTime | Last update timestamp                            |
| `deletedAt`      | DateTime?| Soft-delete flag (non-null = logically deleted)  |

---

## Normalization Rules

| Field         | Rule                                       |
|---------------|--------------------------------------------|
| `email`       | `trim()` + `toLowerCase()`                |
| `phoneNumber` | `trim()` (digits preserved as-is, stored as string) |

Queries exclude soft-deleted contacts (`deletedAt IS NOT NULL`).

---

## Local Setup

### Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** running locally (or a connection string to a remote instance)
- **npm**

### Steps

```bash
# 1. Clone and enter the project
git clone <your-repo-url>
cd BiteSpeed

# 2. Install dependencies (also runs prisma generate via postinstall)
npm install

# 3. Create .env from the example
cp .env.example .env
# Edit .env and set your DATABASE_URL, e.g.:
# DATABASE_URL="postgresql://user:password@localhost:5432/bitespeed?schema=public"

# 4. Run migrations to create the database tables
npx prisma migrate dev --name init

# 5. Seed the database with sample data
npx prisma db seed

# 6. Start the dev server (hot-reload with tsx)
npm run dev
```

The server starts at **http://localhost:3000** (or the port in your `.env`).

---

## API Reference

### `GET /`

Health check. Returns:

```json
{
  "status": "healthy",
  "service": "Bitespeed Identity Reconciliation",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `POST /identify`

**Request body:**

```json
{
  "email": "string (optional)",
  "phoneNumber": "string (optional)"
}
```

At least one of `email` or `phoneNumber` must be provided.

**Response:**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["primary@example.com", "secondary@example.com"],
    "phoneNumbers": ["123456", "789012"],
    "secondaryContactIds": [2, 3]
  }
}
```

---

## Sample curl Requests

> **Note:** These examples assume a freshly seeded database. Run `npx prisma migrate reset` to reset state between test runs.

### 1. Create a new primary (no existing match)

```bash
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "555123"}' | jq
```

**Expected response:**

```json
{
  "contact": {
    "primaryContactId": 5,
    "emails": ["lorraine@hillvalley.edu"],
    "phoneNumbers": ["555123"],
    "secondaryContactIds": []
  }
}
```

_(A new primary contact is created since neither email nor phone match any existing record.)_

### 2. Add a secondary via matching phone + new email

```bash
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "biffsucks@hillvalley.edu", "phoneNumber": "123456"}' | jq
```

**Expected response** (matches seeded George cluster):

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["george@hillvalley.edu", "biffsucks@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2]
  }
}
```

_(Phone "123456" matches George's cluster. Email "biffsucks@hillvalley.edu" already exists in cluster, so no new secondary is created.)_

### 3. Query via email only

```bash
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu"}' | jq
```

**Expected response:**

```json
{
  "contact": {
    "primaryContactId": 3,
    "emails": ["mcfly@hillvalley.edu"],
    "phoneNumbers": ["919191", "717171"],
    "secondaryContactIds": [4]
  }
}
```

_(Email matches Doc's cluster which has two phone numbers.)_

### 4. Merge two primaries

First, create a request that connects George's cluster with a new primary:

```bash
# This email is NEW, this phone matches George (id=1)
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu", "phoneNumber": "123456"}' | jq
```

**Expected response** (George id=1 is older → stays primary; Doc id=3 becomes secondary):

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["george@hillvalley.edu", "biffsucks@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456", "919191", "717171"],
    "secondaryContactIds": [2, 3, 4]
  }
}
```

_(mcfly@hillvalley.edu matched Doc's cluster AND phone 123456 matched George's cluster. Since George is older, Doc's primary becomes a secondary under George.)_

### 5. Idempotent re-query after merge

```bash
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "123456"}' | jq
```

**Expected response** (same merged cluster, no new contacts created):

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["george@hillvalley.edu", "biffsucks@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456", "919191", "717171"],
    "secondaryContactIds": [2, 3, 4]
  }
}
```

---

## Prisma Commands

```bash
# Generate Prisma Client (also runs on npm install via postinstall)
npx prisma generate

# Run migrations in development
npx prisma migrate dev --name <migration-name>

# Apply migrations in production (non-interactive)
npx prisma migrate deploy

# Seed the database
npx prisma db seed

# Reset database (drop all data + re-migrate + re-seed)
npx prisma migrate reset

# Open Prisma Studio (DB GUI)
npx prisma studio
```

---

## Deploy to Render

### Option A: Using `render.yaml` (Blueprint)

1. Push this repo to GitHub.
2. Go to [Render Dashboard](https://dashboard.render.com/) → **Blueprints** → **New Blueprint Instance**.
3. Connect your GitHub repo.
4. Render auto-detects `render.yaml` and provisions:
   - A **PostgreSQL** database (`bitespeed-db`)
   - A **Web Service** (`bitespeed-identity`)
5. The `DATABASE_URL` env var is automatically linked.
6. Click **Apply** and wait for deployment.

### Option B: Manual Dashboard Setup

#### Step 1: Create a PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **PostgreSQL**.
2. Fill in:
   - **Name:** `bitespeed-db`
   - **Database:** `bitespeed`
   - **User:** `bitespeed_user`
   - **Plan:** Free
3. Click **Create Database**.
4. Once created, copy the **Internal Database URL** (looks like `postgres://bitespeed_user:...@.../bitespeed`).

#### Step 2: Create a Web Service

1. Go to **New** → **Web Service**.
2. Connect your GitHub repository.
3. Configure:
   - **Name:** `bitespeed-identity`
   - **Runtime:** Node
   - **Build Command:** `npm install --include=dev && npm run build`
   - **Start Command:** `npx prisma migrate deploy && npx prisma db seed && npm run start`
4. Add **Environment Variables**:
   | Key            | Value                                      |
   |----------------|--------------------------------------------|
   | `DATABASE_URL` | _(paste the Internal Database URL from Step 1)_ |
   | `NODE_ENV`     | `production`                               |
6. Click **Create Web Service**.

#### Step 3: Verify

- Wait for the build to complete and the service to show **"Live"**.
- Visit `https://your-service.onrender.com/` — you should see the health check JSON.
- Test: `curl -X POST https://your-service.onrender.com/identify -H "Content-Type: application/json" -d '{"email":"test@example.com"}'`

---

## Git Commands (Commit Sequence)

```bash
# Initialize repo
git init
git add package.json tsconfig.json .gitignore .env.example .prettierrc
git commit -m "chore: init project with package.json, tsconfig, gitignore"

# Add Prisma schema and seed
git add prisma/
git commit -m "feat: add Prisma schema with Contact model and seed data"

# Add application source code
git add src/
git commit -m "feat: implement Express server and /identify endpoint"

# Add deployment config
git add render.yaml
git commit -m "chore: add Render deployment blueprint"

# Add documentation
git add README.md
git commit -m "docs: add README with setup, API docs, curl examples, and Render deploy steps"

# Push to GitHub
git remote add origin <your-github-repo-url>
git branch -M main
git push -u origin main
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `P1001: Can't reach database` | Check your `DATABASE_URL` in `.env`. Make sure PostgreSQL is running. |
| `prisma generate` fails | Run `npm install` first. The `postinstall` script auto-runs `prisma generate`. |
| Seed fails with "unique constraint" | Run `npx prisma migrate reset` to clear all data and re-run migrations + seed. |
| Port already in use | Change `PORT` in `.env` or kill the process using that port. |
| Render build fails | Ensure `Build Command` is `npm install --include=dev && npm run build`. Check Render build logs. |
| Pre-deploy command error | Since Render free tier restricts Pre-Deploy Commands, migrations and seed are now run inside the `Start Command` just before the server boots. |

---

## Project Structure

```
BiteSpeed/
├── prisma/
│   ├── schema.prisma       # Contact model + PostgreSQL config
│   └── seed.ts              # Sample data seeder
├── src/
│   ├── index.ts             # Express server, health route, graceful shutdown
│   ├── prisma.ts            # Prisma client singleton
│   ├── types.ts             # Shared TypeScript interfaces
│   └── routes/
│       └── identify.ts      # POST /identify — reconciliation logic
├── .env.example             # Environment variable template
├── .gitignore
├── .prettierrc              # Prettier config
├── package.json             # Scripts, dependencies, prisma seed config
├── render.yaml              # Render Blueprint for one-click deploy
├── tsconfig.json            # TypeScript strict config
└── README.md                # This file
```

---

## Deployment Checklist ✅

- [ ] Push repo to GitHub
- [ ] Create Render PostgreSQL database (free tier)
- [ ] Copy Internal Database URL
- [ ] Create Render Web Service, connect GitHub repo
- [ ] Set Build Command: `npm install --include=dev && npm run build`
- [ ] Set Start Command: `npx prisma migrate deploy && npx prisma db seed && npm run start`
- [ ] Add env var `DATABASE_URL` with the Postgres connection string
- [ ] Add env var `NODE_ENV` = `production`
- [ ] Deploy and verify health check at `https://your-service.onrender.com/`
- [ ] Test `/identify` endpoint with curl
