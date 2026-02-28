// ─────────────────────────────────────────────────────────────
// Prisma Client — Singleton export
// ─────────────────────────────────────────────────────────────
// Re-uses a single PrismaClient instance across the application
// to avoid exhausting database connections during development.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
    log:
        process.env.NODE_ENV === "development"
            ? ["query", "info", "warn", "error"]
            : ["warn", "error"],
});

export default prisma;
