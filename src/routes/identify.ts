// ─────────────────────────────────────────────────────────────
// POST /identify — Identity Reconciliation Controller
// ─────────────────────────────────────────────────────────────
// Implements Bitespeed's identity reconciliation rules:
//  1. Find all contacts matching the incoming email OR phoneNumber.
//  2. Expand to the full linked cluster (follow linkedId chains).
//  3. If no match → create a new primary contact.
//  4. If match & incoming data adds new info → create a secondary.
//  5. If two primaries become connected → merge: oldest stays primary,
//     others become secondary. All secondaries point to final primary.
//  6. Return a consolidated response with deduplicated data.
//
// Normalization rules:
//  - Email:       trimmed + lowercased
//  - PhoneNumber: trimmed (digits preserved as-is)
//
// All writes are wrapped in a Prisma interactive transaction to
// prevent race conditions during concurrent requests.
// ─────────────────────────────────────────────────────────────

import { Request, Response } from "express";
import { Contact, LinkPrecedence, Prisma } from "@prisma/client";
import prisma from "../prisma";
import { IdentifyRequest, IdentifyResponse } from "../types";

// ── Input normalization ──────────────────────────────────────

/**
 * Normalize an email string: trim whitespace and convert to lowercase.
 * Returns null if the input is empty/null/undefined.
 */
function normalizeEmail(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const cleaned = raw.trim().toLowerCase();
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Normalize a phone number string: trim whitespace.
 * We store the phone as a plain string (do not strip non-digit chars
 * because the spec says "do not alter digits except trim").
 * Returns null if the input is empty/null/undefined.
 */
function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const cleaned = String(raw).trim();
    return cleaned.length > 0 ? cleaned : null;
}

// ── Cluster expansion ────────────────────────────────────────

/**
 * Given an initial set of matched contacts, expand to the full linked
 * cluster by following linkedId references iteratively until no new
 * contacts are discovered.
 *
 * Uses a single query per iteration with `WHERE id IN (...) OR linkedId IN (...)`.
 */
async function expandCluster(
    tx: Prisma.TransactionClient,
    initialContacts: Contact[]
): Promise<Contact[]> {
    const clusterMap = new Map<number, Contact>();
    for (const c of initialContacts) {
        clusterMap.set(c.id, c);
    }

    let frontier = true;
    while (frontier) {
        const knownIds = Array.from(clusterMap.keys());

        // Collect all linkedId values that point outside our known set
        const linkedIds = Array.from(clusterMap.values())
            .map((c) => c.linkedId)
            .filter((lid): lid is number => lid !== null && !clusterMap.has(lid));

        // Also find contacts whose linkedId points INTO our known set
        const related = await tx.contact.findMany({
            where: {
                deletedAt: null, // exclude soft-deleted
                OR: [
                    { id: { in: linkedIds } },             // primaries we reference
                    { linkedId: { in: knownIds } },         // secondaries that reference us
                ],
            },
        });

        frontier = false;
        for (const r of related) {
            if (!clusterMap.has(r.id)) {
                clusterMap.set(r.id, r);
                frontier = true; // found new contacts → keep expanding
            }
        }
    }

    return Array.from(clusterMap.values());
}

// ── Build consolidated response ──────────────────────────────

/**
 * Build the consolidated response object from a cluster of contacts.
 * - Primary's email/phone appear first in their respective arrays.
 * - Arrays are deduplicated.
 * - secondaryContactIds lists all secondary contact IDs.
 */
function buildResponse(
    primary: Contact,
    cluster: Contact[]
): IdentifyResponse {
    // Separate primary from secondaries
    const secondaries = cluster.filter((c) => c.id !== primary.id);

    // Collect emails: primary's email first, then secondaries (in createdAt order)
    const emailSet = new Set<string>();
    const emails: string[] = [];
    if (primary.email) {
        emails.push(primary.email);
        emailSet.add(primary.email);
    }
    for (const c of secondaries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
        if (c.email && !emailSet.has(c.email)) {
            emails.push(c.email);
            emailSet.add(c.email);
        }
    }

    // Collect phone numbers: primary's phone first, then secondaries
    const phoneSet = new Set<string>();
    const phoneNumbers: string[] = [];
    if (primary.phoneNumber) {
        phoneNumbers.push(primary.phoneNumber);
        phoneSet.add(primary.phoneNumber);
    }
    for (const c of secondaries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
        if (c.phoneNumber && !phoneSet.has(c.phoneNumber)) {
            phoneNumbers.push(c.phoneNumber);
            phoneSet.add(c.phoneNumber);
        }
    }

    // Secondary IDs (all non-primary IDs in the cluster)
    const secondaryContactIds = secondaries
        .sort((a, b) => a.id - b.id)
        .map((c) => c.id);

    return {
        contact: {
            primaryContactId: primary.id,
            emails,
            phoneNumbers,
            secondaryContactIds,
        },
    };
}

// ── Main handler ─────────────────────────────────────────────

export async function identifyHandler(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const body = req.body as IdentifyRequest;
        const email = normalizeEmail(body.email);
        const phone = normalizePhone(body.phoneNumber);

        // Validate: at least one of email or phoneNumber must be provided
        if (!email && !phone) {
            res.status(400).json({
                error: "At least one of 'email' or 'phoneNumber' must be provided.",
            });
            return;
        }

        // ── Run everything inside a transaction ──────────────────
        const result = await prisma.$transaction(async (tx) => {
            // ────────────────────────────────────────────────────────
            // Step 1: Find initial matches by email OR phoneNumber
            // ────────────────────────────────────────────────────────
            const orConditions: Prisma.ContactWhereInput[] = [];
            if (email) orConditions.push({ email });
            if (phone) orConditions.push({ phoneNumber: phone });

            const initialMatches = await tx.contact.findMany({
                where: {
                    deletedAt: null,
                    OR: orConditions,
                },
            });

            // ────────────────────────────────────────────────────────
            // Step 2: No match → create a new primary contact
            // ────────────────────────────────────────────────────────
            if (initialMatches.length === 0) {
                console.log(
                    `[identify] No existing contacts found. Creating new primary contact.`
                );
                const newPrimary = await tx.contact.create({
                    data: {
                        email,
                        phoneNumber: phone,
                        linkPrecedence: LinkPrecedence.primary,
                    },
                });

                return buildResponse(newPrimary, [newPrimary]);
            }

            // ────────────────────────────────────────────────────────
            // Step 3: Expand to the full linked cluster
            // ────────────────────────────────────────────────────────
            const cluster = await expandCluster(tx, initialMatches);
            console.log(
                `[identify] Cluster expanded to ${cluster.length} contact(s). IDs: [${cluster.map((c) => c.id).join(", ")}]`
            );

            // ────────────────────────────────────────────────────────
            // Step 4: Determine the final primary
            //   - Among all rows with linkPrecedence="primary", pick
            //     the one with the earliest createdAt.
            // ────────────────────────────────────────────────────────
            const primaries = cluster
                .filter((c) => c.linkPrecedence === LinkPrecedence.primary)
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            const finalPrimary = primaries[0];

            // ────────────────────────────────────────────────────────
            // Step 5: Merge — if multiple primaries exist, convert all
            //   except the oldest to secondary (batch update).
            // ────────────────────────────────────────────────────────
            if (primaries.length > 1) {
                const idsToConvert = primaries.slice(1).map((c) => c.id);
                console.log(
                    `[identify] Merging primaries. Keeping id=${finalPrimary.id} as primary. Converting ids=[${idsToConvert.join(", ")}] to secondary.`
                );

                // Batch update: convert extra primaries to secondary
                await tx.contact.updateMany({
                    where: { id: { in: idsToConvert } },
                    data: {
                        linkPrecedence: LinkPrecedence.secondary,
                        linkedId: finalPrimary.id,
                        updatedAt: new Date(),
                    },
                });

                // Also update any secondaries that pointed to the converted primaries
                // so they now point to the final primary
                await tx.contact.updateMany({
                    where: { linkedId: { in: idsToConvert } },
                    data: {
                        linkedId: finalPrimary.id,
                        updatedAt: new Date(),
                    },
                });

                // Update in-memory cluster to reflect changes
                for (const c of cluster) {
                    if (idsToConvert.includes(c.id)) {
                        c.linkPrecedence = LinkPrecedence.secondary;
                        c.linkedId = finalPrimary.id;
                    }
                    if (c.linkedId !== null && idsToConvert.includes(c.linkedId)) {
                        c.linkedId = finalPrimary.id;
                    }
                }
            }

            // ────────────────────────────────────────────────────────
            // Step 6: Check if incoming request introduces new info
            //   - If the cluster does not contain the incoming email
            //     or phone, create a new secondary contact.
            // ────────────────────────────────────────────────────────
            const clusterEmails = new Set(
                cluster.map((c) => c.email).filter(Boolean)
            );
            const clusterPhones = new Set(
                cluster.map((c) => c.phoneNumber).filter(Boolean)
            );

            const hasNewEmail = email !== null && !clusterEmails.has(email);
            const hasNewPhone = phone !== null && !clusterPhones.has(phone);

            if (hasNewEmail || hasNewPhone) {
                console.log(
                    `[identify] New information detected. Creating secondary contact linked to primary id=${finalPrimary.id}.`
                );

                const newSecondary = await tx.contact.create({
                    data: {
                        email,
                        phoneNumber: phone,
                        linkedId: finalPrimary.id,
                        linkPrecedence: LinkPrecedence.secondary,
                    },
                });

                cluster.push(newSecondary);
            }

            // ────────────────────────────────────────────────────────
            // Step 7: Build and return consolidated response
            // ────────────────────────────────────────────────────────
            return buildResponse(finalPrimary, cluster);
        });

        res.status(200).json(result);
    } catch (error: unknown) {
        console.error("[identify] Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
