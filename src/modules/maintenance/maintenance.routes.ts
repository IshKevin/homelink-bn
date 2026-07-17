import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import {
    assignMaintenanceRequestSchema,
    completeMaintenanceRequestSchema,
    createMaintenanceRequestSchema,
    listMaintenanceRequestsSchema,
    submitFeedbackSchema,
    updateStatusSchema
} from "./maintenance.validation";
import {
    assignMaintenanceRequestHandler,
    completeMaintenanceRequestHandler,
    createMaintenanceRequestHandler,
    getFeedbackHandler,
    getMaintenanceRequestHandler,
    listMaintenanceRequestsHandler,
    submitFeedbackHandler,
    updateMaintenanceRequestStatusHandler
} from "./maintenance.controller";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * components:
 *   schemas:
 *     CreateMaintenanceRequestInput:
 *       type: object
 *       required: [propertyId, title, description]
 *       properties:
 *         propertyId: { type: string, format: uuid }
 *         title: { type: string, example: "Leaking kitchen faucet" }
 *         description: { type: string, example: "The kitchen faucet has been leaking for two days." }
 * /maintenance-requests:
 *   post:
 *     tags: [Maintenance]
 *     summary: Submit a maintenance request for a leased property (tenant only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateMaintenanceRequestInput' }
 *     responses:
 *       201:
 *         description: Maintenance request submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have an active lease on this property
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   get:
 *     tags: [Maintenance]
 *     summary: List maintenance requests visible to the current user
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [submitted, assigned, in_progress, completed] }
 *       - in: query
 *         name: propertyId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of maintenance requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.post("/", authorize("tenant"), validate(createMaintenanceRequestSchema), createMaintenanceRequestHandler);
router.get(
    "/",
    authorize("tenant", "owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(listMaintenanceRequestsSchema),
    listMaintenanceRequestsHandler
);

/**
 * @openapi
 * /maintenance-requests/{id}:
 *   get:
 *     tags: [Maintenance]
 *     summary: Get a single maintenance request
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Maintenance request details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to access this maintenance request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       404:
 *         description: Maintenance request not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id", authorize("tenant", "owner", "agent", "house_manager", ...ADMIN_ROLES), getMaintenanceRequestHandler);

/**
 * @openapi
 * /maintenance-requests/{id}/assign:
 *   patch:
 *     tags: [Maintenance]
 *     summary: Assign a maintenance request to an owner or agent user (owner, agent, or admin)
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
 *             required: [assignedTo]
 *             properties:
 *               assignedTo: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Maintenance request assigned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: assignedTo must be an owner or agent user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/:id/assign",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(assignMaintenanceRequestSchema),
    assignMaintenanceRequestHandler
);

/**
 * @openapi
 * /maintenance-requests/{id}/status:
 *   patch:
 *     tags: [Maintenance]
 *     summary: Move an assigned maintenance request to in_progress (owner, agent, or admin)
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
 *               status: { type: string, enum: [in_progress] }
 *     responses:
 *       200:
 *         description: Maintenance request status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Request must be assigned before it can move to in progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/:id/status",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(updateStatusSchema),
    updateMaintenanceRequestStatusHandler
);

/**
 * @openapi
 * /maintenance-requests/{id}/complete:
 *   patch:
 *     tags: [Maintenance]
 *     summary: Mark a maintenance request as completed (owner, agent, or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               itemsCost: { type: number }
 *               laborCost: { type: number }
 *               completionNotes: { type: string }
 *     responses:
 *       200:
 *         description: Maintenance request completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Request must be assigned or in progress before it can be completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/:id/complete",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(completeMaintenanceRequestSchema),
    completeMaintenanceRequestHandler
);

/**
 * @openapi
 * /maintenance-requests/{id}/feedback:
 *   post:
 *     tags: [Maintenance]
 *     summary: Submit feedback for a completed maintenance request (tenant only)
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
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *     responses:
 *       201:
 *         description: Feedback submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Feedback can only be submitted after the request is completed, or feedback already submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   get:
 *     tags: [Maintenance]
 *     summary: Get feedback for a maintenance request
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Feedback for the request, or null if none has been submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/:id/feedback", authorize("tenant"), validate(submitFeedbackSchema), submitFeedbackHandler);
router.get("/:id/feedback", authorize("tenant", "owner", "agent", "house_manager", ...ADMIN_ROLES), getFeedbackHandler);

export default router;
