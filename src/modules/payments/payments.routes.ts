import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import { listInvoicesSchema, listPaymentsSchema, payInvoiceSchema, rejectPaymentSchema } from "./payments.validation";
import {
    approvePaymentHandler,
    exportPaymentsHandler,
    getInvoiceHandler,
    getReceiptHandler,
    listInvoicesHandler,
    listPaymentsHandler,
    payInvoiceHandler,
    rejectPaymentHandler
} from "./payments.controller";

// Two separate routers, each mounted at its own real prefix (/invoices, /payments)
// in routes/index.ts. Mounting a single router at "/" would give this module's
// `authenticate` a global reach over every sibling route registered after it —
// see the comment in routes/index.ts for the incident this avoids.
const invoicesRouter = Router();
const paymentsRouter = Router();

invoicesRouter.use(authenticate);
paymentsRouter.use(authenticate);

/**
 * @openapi
 * /invoices:
 *   get:
 *     tags: [Payments]
 *     summary: List invoices visible to the current user
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [unpaid, paid, overdue] }
 *       - in: query
 *         name: period
 *         schema: { type: string, example: "2026-01" }
 *       - in: query
 *         name: leaseId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of invoices
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
invoicesRouter.get("/", authorize("tenant", "owner", "house_manager", ...ADMIN_ROLES), validate(listInvoicesSchema), listInvoicesHandler);

/**
 * @openapi
 * /invoices/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Get a single invoice
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Invoice details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to access this invoice
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       404:
 *         description: Invoice not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
invoicesRouter.get("/:id", authorize("tenant", "owner", "house_manager", ...ADMIN_ROLES), getInvoiceHandler);

/**
 * @openapi
 * components:
 *   schemas:
 *     PayInvoiceInput:
 *       type: object
 *       required: [method]
 *       properties:
 *         method: { type: string, enum: [mobile_money, bank_transfer, cash], description: "cash and bank_transfer are held pending the landlord's approval (see /payments/{id}/approve); mobile_money settles instantly via the mocked provider" }
 *         carrier: { type: string, enum: [mtn, airtel], description: "Only used when method is mobile_money; defaults to mtn" }
 *         payerPhone: { type: string }
 *         payerAccount: { type: string }
 * /invoices/{id}/pay:
 *   post:
 *     tags: [Payments]
 *     summary: Pay an invoice — instantly via mobile_money, or pending landlord approval for cash/bank_transfer (tenant only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PayInvoiceInput' }
 *     responses:
 *       201:
 *         description: Payment initiated (may succeed or fail depending on the provider result)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Only the tenant on this lease may pay this invoice
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       409:
 *         description: Invoice is already paid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
invoicesRouter.post("/:id/pay", authorize("tenant"), validate(payInvoiceSchema), payInvoiceHandler);

/**
 * @openapi
 * /payments:
 *   get:
 *     tags: [Payments]
 *     summary: List payment history visible to the current user
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, success, failed] }
 *       - in: query
 *         name: invoiceId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of payments
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
paymentsRouter.get("/", authorize("tenant", "owner", "house_manager", ...ADMIN_ROLES), validate(listPaymentsSchema), listPaymentsHandler);

/**
 * @openapi
 * /payments/export:
 *   get:
 *     tags: [Payments]
 *     summary: Export payment history as an Excel workbook (owner or admin)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, success, failed] }
 *       - in: query
 *         name: invoiceId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Excel workbook of payments
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
paymentsRouter.get("/export", authorize("owner", "house_manager", ...ADMIN_ROLES), exportPaymentsHandler);

/**
 * @openapi
 * /payments/{id}/receipt:
 *   get:
 *     tags: [Payments]
 *     summary: Get a presigned URL for a successful payment's receipt
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Presigned receipt URL
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Receipt not available for this payment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
paymentsRouter.get("/:id/receipt", authorize("tenant", "owner", "house_manager", ...ADMIN_ROLES), getReceiptHandler);

/**
 * @openapi
 * /payments/{id}/approve:
 *   patch:
 *     tags: [Payments]
 *     summary: Approve a cash or bank-transfer payment awaiting landlord approval (owner, house manager, or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment approved and invoice marked paid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Payment is not awaiting approval
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
paymentsRouter.patch("/:id/approve", authorize("owner", "house_manager", ...ADMIN_ROLES), approvePaymentHandler);

/**
 * @openapi
 * /payments/{id}/reject:
 *   patch:
 *     tags: [Payments]
 *     summary: Reject a cash or bank-transfer payment awaiting landlord approval (owner, house manager, or admin)
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
 *         description: Payment rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Payment is not awaiting approval
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
paymentsRouter.patch(
    "/:id/reject",
    authorize("owner", "house_manager", ...ADMIN_ROLES),
    validate(rejectPaymentSchema),
    rejectPaymentHandler
);

export { invoicesRouter, paymentsRouter };
