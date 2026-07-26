import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { leadsRateLimiter } from "../../common/middlewares/rateLimiter.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import { listLeadsSchema, submitContactSchema, submitGetStartedSchema, updateLeadStatusSchema } from "./leads.validation";
import {
    listLeadsHandler,
    submitContactHandler,
    submitGetStartedHandler,
    updateLeadStatusHandler
} from "./leads.controller";

const router = Router();

/**
 * @openapi
 * /leads/contact:
 *   post:
 *     tags: [Leads]
 *     summary: Submit the public contact form (unauthenticated)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, subject, message]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string }
 *               subject: { type: string }
 *               message: { type: string }
 *     responses:
 *       201:
 *         description: Message sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/contact", leadsRateLimiter, validate(submitContactSchema), submitContactHandler);

/**
 * @openapi
 * /leads/get-started:
 *   post:
 *     tags: [Leads]
 *     summary: Submit the public "Get Started" request form (unauthenticated)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, phone]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               roleInterest: { type: string, enum: [owner, house_manager, tenant, agent] }
 *               propertyCount: { type: integer }
 *               message: { type: string }
 *     responses:
 *       201:
 *         description: Request submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/get-started", leadsRateLimiter, validate(submitGetStartedSchema), submitGetStartedHandler);

router.use(authenticate);

/**
 * @openapi
 * /leads:
 *   get:
 *     tags: [Leads]
 *     summary: List submitted leads (admin only)
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [contact, get_started] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, contacted, converted, dismissed] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of leads
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/", authorize(...ADMIN_ROLES), validate(listLeadsSchema), listLeadsHandler);

/**
 * @openapi
 * /leads/{id}/status:
 *   patch:
 *     tags: [Leads]
 *     summary: Update a lead's status (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [new, contacted, converted, dismissed] }
 *     responses:
 *       200:
 *         description: Lead status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.patch("/:id/status", authorize(...ADMIN_ROLES), validate(updateLeadStatusSchema), updateLeadStatusHandler);

export default router;
