import { Router } from "express";
import { validate } from "../../common/middlewares/validate.middleware";
import { mtnMomoCallbackSchema } from "./webhooks.validation";
import { mtnCollectionCallbackHandler, mtnDisbursementCallbackHandler } from "./webhooks.controller";

// Deliberately its own router, mounted at a distinct top-level path
// (routes/index.ts -> /webhooks) rather than added to paymentsRouter —
// that router applies `authenticate` to everything on it, and MTN can't
// send our JWTs. See payments.routes.ts's comment on the same principle.
const router = Router();

/**
 * @openapi
 * /webhooks/mtn/collection/{referenceId}:
 *   post:
 *     tags: [Payments]
 *     summary: MTN MoMo Collections callback (Request to Pay result) — called by MTN, not clients
 *     security: []
 *     parameters:
 *       - in: path
 *         name: referenceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Acknowledged
 */
router.post("/mtn/collection/:referenceId", validate(mtnMomoCallbackSchema), mtnCollectionCallbackHandler);

/**
 * @openapi
 * /webhooks/mtn/disbursement/{referenceId}:
 *   post:
 *     tags: [Payments]
 *     summary: MTN MoMo Disbursements callback (Transfer result) — called by MTN, not clients
 *     security: []
 *     parameters:
 *       - in: path
 *         name: referenceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Acknowledged
 */
router.post("/mtn/disbursement/:referenceId", validate(mtnMomoCallbackSchema), mtnDisbursementCallbackHandler);

export default router;
