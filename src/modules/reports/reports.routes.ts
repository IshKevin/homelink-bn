import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import { validate } from "../../common/middlewares/validate.middleware";
import { reportQuerySchema } from "./reports.validation";
import {
    getAgentPerformanceHandler,
    getLandlordPerformanceHandler,
    getMaintenanceActivityHandler,
    getOccupancyHandler,
    getPaymentHistoryHandler,
    getRentalHistoryHandler,
    getRevenuePerformanceHandler
} from "./reports.controller";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /reports/rental-history:
 *   get:
 *     tags: [Reports]
 *     summary: Get a rental history report (leases scoped to the requester)
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *         description: Period start date (yyyy-MM-dd). Defaults to the start of the current year.
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *         description: Period end date (yyyy-MM-dd). Defaults to the end of the current year.
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Rental history report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/rental-history", authorize("tenant", "owner", "admin"), validate(reportQuerySchema), getRentalHistoryHandler);

/**
 * @openapi
 * /reports/payment-history:
 *   get:
 *     tags: [Reports]
 *     summary: Get a payment history report scoped to the requester
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Payment history report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/payment-history", authorize("tenant", "owner", "admin"), validate(reportQuerySchema), getPaymentHistoryHandler);

/**
 * @openapi
 * /reports/occupancy:
 *   get:
 *     tags: [Reports]
 *     summary: Get an occupancy report for the requester's properties
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Occupancy report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/occupancy", authorize("owner", "admin"), validate(reportQuerySchema), getOccupancyHandler);

/**
 * @openapi
 * /reports/maintenance-activity:
 *   get:
 *     tags: [Reports]
 *     summary: Get a maintenance activity report for the requester's properties
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Maintenance activity report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/maintenance-activity", authorize("owner", "admin"), validate(reportQuerySchema), getMaintenanceActivityHandler);

/**
 * @openapi
 * /reports/revenue-performance:
 *   get:
 *     tags: [Reports]
 *     summary: Get a monthly revenue performance report for the requester's properties
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Revenue performance report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/revenue-performance", authorize("owner", "admin"), validate(reportQuerySchema), getRevenuePerformanceHandler);

/**
 * @openapi
 * /reports/agent-performance:
 *   get:
 *     tags: [Reports]
 *     summary: Get a platform-wide agent performance report (admin only)
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Agent performance report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/agent-performance", authorize(...ADMIN_ROLES), validate(reportQuerySchema), getAgentPerformanceHandler);

/**
 * @openapi
 * /reports/landlord-performance:
 *   get:
 *     tags: [Reports]
 *     summary: Get a platform-wide landlord directory/performance report (admin only)
 *     description: Current-state snapshot (not date-ranged) — one row per owner with their property count, account status, and registration date.
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, excel] }
 *     responses:
 *       200:
 *         description: Landlord performance report (JSON, or a binary xlsx when format=excel)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/landlord-performance", authorize(...ADMIN_ROLES), validate(reportQuerySchema), getLandlordPerformanceHandler);

export default router;
