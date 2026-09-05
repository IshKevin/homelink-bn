import express, { Router } from "express";
import { sesNotificationHandler } from "./ses.webhooks.controller";

// Its own router for the same reason payments/webhooks.routes.ts is —
// mounted at a distinct top-level path, unauthenticated by necessity (SNS
// can't send our JWTs; the SNS message signature check inside the handler
// is what stands in for auth here).
const router = Router();

/**
 * @openapi
 * /webhooks/ses/notifications:
 *   post:
 *     tags: [Payments]
 *     summary: SES bounce/complaint notifications via SNS — called by AWS, not clients
 *     description: Handles both the SNS subscription-confirmation handshake and ongoing Bounce/Complaint notifications. Every payload's signature is verified against AWS's own signing cert before anything is trusted.
 *     security: []
 *     responses:
 *       200:
 *         description: Acknowledged (or subscription confirmed)
 *       400:
 *         description: Invalid SNS signature
 */
router.post(
    "/notifications",
    // SNS POSTs as Content-Type: text/plain, not application/json, so the
    // app-wide express.json() (which only parses application/json bodies)
    // leaves this one unparsed — parse it here instead, scoped to just this
    // route rather than loosening body-parsing globally.
    express.json({ type: () => true }),
    sesNotificationHandler
);

export default router;
