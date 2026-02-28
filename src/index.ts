// ─────────────────────────────────────────────────────────────
// Express Server — Bitespeed Identity Reconciliation
// ─────────────────────────────────────────────────────────────

import express from "express";
import prisma from "./prisma";
import { identifyHandler } from "./routes/identify";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());

// ── Health check ─────────────────────────────────────────────
app.get("/", (_req, res) => {
    res.status(200).json({
        status: "healthy",
        service: "Bitespeed Identity Reconciliation",
        timestamp: new Date().toISOString(),
    });
});

app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

// ── Routes ───────────────────────────────────────────────────
app.post("/identify", identifyHandler);

// ── Start server ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`   POST /identify — Identity reconciliation endpoint`);
    console.log(`   GET  /         — Health check`);
});

// ── Graceful shutdown ────────────────────────────────────────
const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n⏻  Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
        console.log("   HTTP server closed.");
    });
    await prisma.$disconnect();
    console.log("   Prisma client disconnected.");
    process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;
