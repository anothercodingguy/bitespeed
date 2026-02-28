// ─────────────────────────────────────────────────────────────
// Shared Types — Request / Response shapes
// ─────────────────────────────────────────────────────────────

/**
 * Incoming JSON body for POST /identify
 * At least one of email or phoneNumber should be provided.
 */
export interface IdentifyRequest {
    email?: string | null;
    phoneNumber?: string | null;
}

/**
 * The consolidated contact object returned by the /identify endpoint.
 */
export interface ConsolidatedContact {
    primaryContactId: number;
    emails: string[];           // deduplicated, primary's email first
    phoneNumbers: string[];     // deduplicated, primary's phone first
    secondaryContactIds: number[];
}

/**
 * Full response shape for POST /identify
 */
export interface IdentifyResponse {
    contact: ConsolidatedContact;
}
