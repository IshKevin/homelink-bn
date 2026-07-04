import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import {
    createLeaseSchema,
    createMoveRequestSchema,
    decideChangeRequestRejectSchema,
    inspectMoveRequestSchema,
    listLeasesSchema,
    renewalRequestSchema,
    terminationRequestSchema,
    updateChecklistSchema
} from "./leases.validation";
import {
    approveChangeRequestHandler,
    createLeaseHandler,
    createMoveRequestHandler,
    getLeaseDocumentHandler,
    getLeaseHandler,
    inspectMoveRequestHandler,
    listChangeRequestsHandler,
    listLeasesHandler,
    listMoveRequestsHandler,
    rejectChangeRequestHandler,
    requestRenewalHandler,
    requestTerminationHandler,
    signLeaseHandler,
    updateMoveRequestChecklistHandler
} from "./leases.controller";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * components:
 *   schemas:
 *     CreateLeaseInput:
 *       type: object
 *       required: [propertyId, tenantId, startDate, endDate, rentAmount]
 *       properties:
 *         propertyId: { type: string, format: uuid }
 *         tenantId: { type: string, format: uuid }
 *         startDate: { type: string, example: "2026-01-01" }
 *         endDate: { type: string, example: "2026-12-31" }
 *         rentAmount: { type: number }
 * /leases:
 *   post:
 *     tags: [Leases]
 *     summary: Create a lease for a property (owner or admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateLeaseInput' }
 *     responses:
 *       201:
 *         description: Lease created and pending signatures
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Property or tenant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       409:
 *         description: Property is not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   get:
 *     tags: [Leases]
 *     summary: List leases visible to the current user
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, pending_signatures, active, pending_renewal, pending_termination, terminated, expired] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of leases
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.post("/", authorize("owner", "admin"), validate(createLeaseSchema), createLeaseHandler);
router.get("/", validate(listLeasesSchema), listLeasesHandler);

/**
 * @openapi
 * /leases/{id}:
 *   get:
 *     tags: [Leases]
 *     summary: Get a single lease
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lease details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to access this lease
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       404:
 *         description: Lease not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id", getLeaseHandler);

/**
 * @openapi
 * /leases/{id}/sign:
 *   post:
 *     tags: [Leases]
 *     summary: Sign a lease as tenant or owner
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lease signed (activated once both parties have signed)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Lease is not awaiting signatures
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/:id/sign", authorize("tenant", "owner"), signLeaseHandler);

/**
 * @openapi
 * /leases/{id}/document:
 *   get:
 *     tags: [Leases]
 *     summary: Get the lease document (presigned URL if generated, otherwise a preview PDF)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Presigned download URL, or a streamed PDF preview if no document has been stored yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get("/:id/document", getLeaseDocumentHandler);

/**
 * @openapi
 * /leases/{id}/renewal-requests:
 *   post:
 *     tags: [Leases]
 *     summary: Request a lease renewal
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
 *               proposedRent: { type: number }
 *               proposedEndDate: { type: string, example: "2027-01-01" }
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Renewal request created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Lease must be active to request a change
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/:id/renewal-requests", authorize("tenant", "owner"), validate(renewalRequestSchema), requestRenewalHandler);

/**
 * @openapi
 * /leases/{id}/termination-requests:
 *   post:
 *     tags: [Leases]
 *     summary: Request a lease termination
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
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Termination request created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Lease must be active to request a change
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post(
    "/:id/termination-requests",
    authorize("tenant", "owner"),
    validate(terminationRequestSchema),
    requestTerminationHandler
);

/**
 * @openapi
 * /leases/{id}/change-requests:
 *   get:
 *     tags: [Leases]
 *     summary: List renewal/termination change requests for a lease
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of change requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/:id/change-requests", listChangeRequestsHandler);

/**
 * @openapi
 * /leases/change-requests/{id}/approve:
 *   patch:
 *     tags: [Leases]
 *     summary: Approve a pending change request (owner or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Change request approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Change request has already been decided
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/change-requests/:id/approve", authorize("owner", "admin"), approveChangeRequestHandler);

/**
 * @openapi
 * /leases/change-requests/{id}/reject:
 *   patch:
 *     tags: [Leases]
 *     summary: Reject a pending change request (owner or admin)
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
 *             required: [decisionNotes]
 *             properties:
 *               decisionNotes: { type: string }
 *     responses:
 *       200:
 *         description: Change request rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: decisionNotes is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/change-requests/:id/reject",
    authorize("owner", "admin"),
    validate(decideChangeRequestRejectSchema),
    rejectChangeRequestHandler
);

/**
 * @openapi
 * /leases/{id}/move-requests:
 *   post:
 *     tags: [Leases]
 *     summary: Create a move-out request (tenant only)
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
 *             required: [type]
 *             properties:
 *               type: { type: string, enum: [move_out] }
 *     responses:
 *       201:
 *         description: Move-out request created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   get:
 *     tags: [Leases]
 *     summary: List move-in/move-out requests for a lease
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of move requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/:id/move-requests", authorize("tenant"), validate(createMoveRequestSchema), createMoveRequestHandler);
router.get("/:id/move-requests", listMoveRequestsHandler);

/**
 * @openapi
 * /leases/move-requests/{id}/checklist:
 *   patch:
 *     tags: [Leases]
 *     summary: Update a move request's checklist (tenant or owner)
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
 *             required: [checklist]
 *             properties:
 *               checklist:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     label: { type: string }
 *                     done: { type: boolean }
 *     responses:
 *       200:
 *         description: Checklist updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.patch(
    "/move-requests/:id/checklist",
    authorize("tenant", "owner"),
    validate(updateChecklistSchema),
    updateMoveRequestChecklistHandler
);

/**
 * @openapi
 * /leases/move-requests/{id}/inspect:
 *   patch:
 *     tags: [Leases]
 *     summary: Complete inspection of a move-out request (owner or admin)
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
 *             required: [inspectionNotes]
 *             properties:
 *               inspectionNotes: { type: string }
 *     responses:
 *       200:
 *         description: Move request inspected and completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Only move-out requests can be inspected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/move-requests/:id/inspect",
    authorize("owner", "admin"),
    validate(inspectMoveRequestSchema),
    inspectMoveRequestHandler
);

export default router;
