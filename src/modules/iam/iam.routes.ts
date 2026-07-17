import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import {
    acceptInviteSchema,
    createSuspensionRequestSchema,
    inviteManagerSchema,
    inviteTenantSchema,
    listInvitesSchema
} from "./iam.validation";
import {
    acceptInviteHandler,
    createSuspensionRequestHandler,
    inviteManagerHandler,
    inviteTenantHandler,
    listInvitesHandler,
    listManagersHandler,
    revokeManagerHandler
} from "./iam.controller";

const router = Router();

/**
 * @openapi
 * /iam/invites/accept:
 *   post:
 *     tags: [IAM]
 *     summary: Accept an invite link and create an account (public)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, firstName, lastName, phone, password]
 *             properties:
 *               token: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phone: { type: string }
 *               password: { type: string }
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid or expired invite
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/invites/accept", validate(acceptInviteSchema), acceptInviteHandler);

router.use(authenticate);

/**
 * @openapi
 * /iam/managers/invite:
 *   post:
 *     tags: [IAM]
 *     summary: Invite a house manager (house owner only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *     responses:
 *       201:
 *         description: Invite sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/managers/invite", authorize("owner"), validate(inviteManagerSchema), inviteManagerHandler);

/**
 * @openapi
 * /iam/managers:
 *   get:
 *     tags: [IAM]
 *     summary: List managers for the current owner (or the manager's linked owner)
 *     responses:
 *       200:
 *         description: List of manager assignments
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/managers", authorize("owner", "house_manager"), listManagersHandler);

/**
 * @openapi
 * /iam/managers/{id}/revoke:
 *   patch:
 *     tags: [IAM]
 *     summary: Revoke a house manager's access (house owner only, does not delete the manager's account)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Manager access revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Manager assignment is already revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/managers/:id/revoke", authorize("owner"), revokeManagerHandler);

/**
 * @openapi
 * /iam/tenants/invite:
 *   post:
 *     tags: [IAM]
 *     summary: Invite a tenant (house owner or house manager)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *               propertyId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Invite sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/tenants/invite", authorize("owner", "house_manager"), validate(inviteTenantSchema), inviteTenantHandler);

/**
 * @openapi
 * /iam/invites:
 *   get:
 *     tags: [IAM]
 *     summary: List invites created under the current owner (or the manager's linked owner)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of invites
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/invites", authorize("owner", "house_manager"), validate(listInvitesSchema), listInvitesHandler);

/**
 * @openapi
 * /iam/suspension-requests:
 *   post:
 *     tags: [IAM]
 *     summary: Request that an admin suspend a user (house owner or house manager)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetUserId, reason]
 *             properties:
 *               targetUserId: { type: string, format: uuid }
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Suspension request submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post(
    "/suspension-requests",
    authorize("owner", "house_manager"),
    validate(createSuspensionRequestSchema),
    createSuspensionRequestHandler
);

export default router;
