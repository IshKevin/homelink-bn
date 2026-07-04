import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import {
    deactivatePropertySchema,
    listAuditLogsSchema,
    listIdentityVerificationsSchema,
    listUsersSchema,
    rejectIdentityVerificationSchema,
    updateUserStatusSchema,
    upsertSettingSchema
} from "./admin.validation";
import {
    approveAgentHandler,
    approveIdentityVerificationHandler,
    deactivatePropertyHandler,
    getSettingsHandler,
    getUserHandler,
    listAuditLogsHandler,
    listIdentityVerificationsHandler,
    listUsersHandler,
    reactivatePropertyHandler,
    rejectIdentityVerificationHandler,
    updateUserStatusHandler,
    upsertSettingHandler
} from "./admin.controller";

const router = Router();

router.use(authenticate);
router.use(authorize("admin"));

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List all users with optional filters (admin only)
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [tenant, owner, agent, admin] }
 *       - in: query
 *         name: isApproved
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.get("/users", validate(listUsersSchema), listUsersHandler);

/**
 * @openapi
 * /admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Get a single user by id (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/users/:id", getUserHandler);

/**
 * @openapi
 * /admin/users/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Activate or deactivate a user's account (admin only)
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
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: User status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/users/:id/status", validate(updateUserStatusSchema), updateUserStatusHandler);

/**
 * @openapi
 * /admin/users/{id}/approve-agent:
 *   patch:
 *     tags: [Admin]
 *     summary: Approve a pending agent account (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agent approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: User is not an agent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       409:
 *         description: Agent is already approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/users/:id/approve-agent", approveAgentHandler);

/**
 * @openapi
 * /admin/identity-verifications:
 *   get:
 *     tags: [Admin]
 *     summary: List identity verification submissions (admin only)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of identity verifications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.get("/identity-verifications", validate(listIdentityVerificationsSchema), listIdentityVerificationsHandler);

/**
 * @openapi
 * /admin/identity-verifications/{id}/approve:
 *   patch:
 *     tags: [Admin]
 *     summary: Approve an identity verification submission (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Identity verification approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Identity verification has already been reviewed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/identity-verifications/:id/approve", approveIdentityVerificationHandler);

/**
 * @openapi
 * /admin/identity-verifications/{id}/reject:
 *   patch:
 *     tags: [Admin]
 *     summary: Reject an identity verification submission (admin only)
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
 *             required: [reviewNotes]
 *             properties:
 *               reviewNotes: { type: string }
 *     responses:
 *       200:
 *         description: Identity verification rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Identity verification has already been reviewed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/identity-verifications/:id/reject",
    validate(rejectIdentityVerificationSchema),
    rejectIdentityVerificationHandler
);

/**
 * @openapi
 * /admin/properties/{id}/deactivate:
 *   patch:
 *     tags: [Admin]
 *     summary: Deactivate a property listing (content moderation, admin only)
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Property deactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Property is already deactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/properties/:id/deactivate", validate(deactivatePropertySchema), deactivatePropertyHandler);

/**
 * @openapi
 * /admin/properties/{id}/reactivate:
 *   patch:
 *     tags: [Admin]
 *     summary: Reactivate a previously deactivated property listing (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Property reactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Property is already active
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/properties/:id/reactivate", reactivatePropertyHandler);

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: List all platform settings (admin only)
 *     responses:
 *       200:
 *         description: List of platform settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/settings", getSettingsHandler);

/**
 * @openapi
 * /admin/settings/{key}:
 *   put:
 *     tags: [Admin]
 *     summary: Create or update a platform setting (admin only)
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: {}
 *     responses:
 *       200:
 *         description: Platform setting saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.put("/settings/:key", validate(upsertSettingSchema), upsertSettingHandler);

/**
 * @openapi
 * /admin/audit-logs:
 *   get:
 *     tags: [Admin]
 *     summary: List audit log entries (admin only)
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: entity
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of audit log entries
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.get("/audit-logs", validate(listAuditLogsSchema), listAuditLogsHandler);

export default router;
