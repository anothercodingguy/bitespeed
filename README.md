# Bitespeed Identity Reconciliation 🚀

A Node.js backend to handle identity reconciliation. It exposes a single `POST /identify` endpoint that links contacts by email or phone number and returns a consolidated profile.

Tech Stack: **Node.js, Express, TypeScript, Prisma, PostgreSQL**

## Running Locally

1. Clone the repo and install packages:
   ```bash
   npm install
   ```

2. Set up your `.env`:
   ```bash
   cp .env.example .env
   # Add your local Postgres DATABASE_URL
   ```

3. Run migrations and seed the DB with sample data:
   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```

4. Start the dev server:
   ```bash
   npm run dev
   ```

## API Endpoint

**`POST /identify`**

Body (must provide at least one):
```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

Response:
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["george@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2, 3]
  }
}
```

## Quick Test (curl)

Create a new contact:
```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "555123"}'
```

Link an existing contact with a new email:
```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "biff@hillvalley.edu", "phoneNumber": "555123"}'
```

## Deployment Info (Render Free Tier)

This repo is set up to deploy seamlessly on Render's free tier.

**Blueprint Deploy:**
Just connect this repo to Render and it will use the `render.yaml` to spin up the Web Service and Postgres DB automatically.

**Manual Deploy Notes:**
Because Render restricts pre-deploy commands on the free tier, the start command handles migrations and seeding:
`npx prisma migrate deploy && npx prisma db seed && npm run start`

Make sure your `DATABASE_URL` is set in the Render environment variables!
