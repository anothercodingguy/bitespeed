// ─────────────────────────────────────────────────────────────
// Seed Script — Inserts sample contacts matching Bitespeed PDF
// ─────────────────────────────────────────────────────────────

import { PrismaClient, LinkPrecedence } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
    console.log("🌱 Seeding database with sample contacts...\n");

    // Check if database already has data to avoid wiping production on cold starts
  const count = await prisma.contact.count();
  if (count > 0) {
    console.log(`  ✓ Database already contains ${count} contacts. Skipping seed.`);
    return;
  }

    // ── Example from Bitespeed PDF ──────────────────────────────
    // George has two contact rows:
    //   1. Primary:   phone "123456", email "george@hillvalley.edu"
    //   2. Secondary: phone "123456", email "biffsucks@hillvalley.edu"

    const george1 = await prisma.contact.create({
        data: {
            phoneNumber: "123456",
            email: "george@hillvalley.edu",
            linkPrecedence: LinkPrecedence.primary,
            createdAt: new Date("2023-04-01T00:00:00.000Z"),
        },
    });
    console.log(`  ✓ Created primary contact id=${george1.id}  (George — george@hillvalley.edu)`);

    const george2 = await prisma.contact.create({
        data: {
            phoneNumber: "123456",
            email: "biffsucks@hillvalley.edu",
            linkedId: george1.id,
            linkPrecedence: LinkPrecedence.secondary,
            createdAt: new Date("2023-04-20T05:30:00.000Z"),
        },
    });
    console.log(`  ✓ Created secondary contact id=${george2.id} (George — biffsucks@hillvalley.edu)`);

    // ── Additional test data: a separate primary that could be merged ──
    // Doc Brown — different email and phone (no overlap with George yet)
    const doc1 = await prisma.contact.create({
        data: {
            phoneNumber: "919191",
            email: "mcfly@hillvalley.edu",
            linkPrecedence: LinkPrecedence.primary,
            createdAt: new Date("2023-04-11T00:00:00.000Z"),
        },
    });
    console.log(`  ✓ Created primary contact id=${doc1.id}  (Doc — mcfly@hillvalley.edu)`);

    const doc2 = await prisma.contact.create({
        data: {
            phoneNumber: "717171",
            email: "mcfly@hillvalley.edu",
            linkedId: doc1.id,
            linkPrecedence: LinkPrecedence.secondary,
            createdAt: new Date("2023-04-21T05:30:00.000Z"),
        },
    });
    console.log(`  ✓ Created secondary contact id=${doc2.id} (Doc — mcfly@hillvalley.edu, phone 717171)`);

    console.log("\n✅ Seed complete. Inserted 4 contacts.\n");
}

main()
    .catch((error: unknown) => {
        console.error("❌ Seed failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
