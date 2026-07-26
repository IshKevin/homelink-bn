import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
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
    addLeaseDocumentsHandler,
    approveChangeRequestHandler,
    confirmLeaseDocumentsHandler,
    createLeaseHandler,
    createMoveRequestHandler,
    deleteLeaseDocumentHandler,
    getLeaseDocumentHandler,
    getLeaseHandler,
    inspectMoveRequestHandler,
    listChangeRequestsHandler,
    listLeaseDocumentsHandler,
    listLeasesHandler,
    listMoveRequestsHandler,
    rejectChangeRequestHandler,
    requestRenewalHandler,
    requestTerminationHandler,
    signLeaseHandler,
    updateMoveRequestChecklistHandler
} from "./leases.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * components:
 *   schemas:
 *     CreateLeaseInput:
 *       type: object
 *       required: [propertyId, unitId, tenantId, startDate, rentAmount]
 *       properties:
 *         propertyId: { type: string, format: uuid }
 *         unitId: { type: string, format: uuid, description: "A specific unit on this property (must be available); see /properties/{id}/units" }
 *         tenantId: { type: string, format: uuid }
 *         startDate: { type: string, example: "2026-01-01" }
 *         endDate: { type: string, example: "2026-12-31", description: "Optional — omit for an open-ended lease" }
 *         paymentDate: { type: string, example: "2026-01-05", description: "Optional agreed recurring payment date (day-of-month); drives invoice due dates" }
 *         rentAmount: { type: number }
 *         deposit: { type: number, description: "Optional security deposit" }
 *         momoNumber: { type: string, description: "Optional tenant mobile money number for rent collection" }
 *         leasePeriodNote: { type: string, example: "12-month renewable lease" }
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
 *         description: Unit is not available
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
router.post(
    "/",
    authorize("owner", "house_manager", ...ADMIN_ROLES),
    validate(createLeaseSchema),
    createLeaseHandler
);
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
router.post(
    "/:id/renewal-requests",
    authorize("tenant", "owner", "house_manager"),
    validate(renewalRequestSchema),
    requestRenewalHandler
);

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
    authorize("tenant", "owner", "house_manager"),
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
router.patch(
    "/change-requests/:id/approve",
    authorize("owner", "house_manager", ...ADMIN_ROLES),
    approveChangeRequestHandler
);

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
    authorize("owner", "house_manager", ...ADMIN_ROLES),
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
    authorize("tenant", "owner", "house_manager"),
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
    authorize("owner", "house_manager", ...ADMIN_ROLES),
    validate(inspectMoveRequestSchema),
    inspectMoveRequestHandler
);

/**
 * @openapi
 * /leases/{id}/documents:
 *   post:
 *     tags: [Leases]
 *     summary: Upload optional scanned/physical lease documents (tenant, owner, house manager, or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               documents:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Documents uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   get:
 *     tags: [Leases]
 *     summary: List uploaded documents for a lease
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of lease documents
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/:id/documents", upload.array("documents", 5), addLeaseDocumentsHandler);
router.get("/:id/documents", listLeaseDocumentsHandler);

/**
 * @openapi
 * /leases/{id}/documents/{documentId}:
 *   delete:
 *     tags: [Leases]
 *     summary: Delete an uploaded lease document
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Document deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.delete("/:id/documents/:documentId", deleteLeaseDocumentHandler);

/**
 * @openapi
 * /leases/{id}/documents/confirm:
 *   patch:
 *     tags: [Leases]
 *     summary: Confirm the lease's documents (physical or uploaded) are accurate and received
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lease documents confirmed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Lease documents have already been confirmed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/:id/documents/confirm", confirmLeaseDocumentsHandler);

export default router;
