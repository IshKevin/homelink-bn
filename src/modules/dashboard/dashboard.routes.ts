import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import { statementQuerySchema } from "./dashboard.validation";
import {
    getAdminDashboardHandler,
    getAgentDashboardHandler,
    getMyDashboardHandler,
    getOwnerDashboardHandler,
    getStatementHandler,
    getTenantDashboardHandler
} from "./dashboard.controller";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /dashboard/owner:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get the financial dashboard for the authenticated property owner
 *     responses:
 *       200:
 *         description: Owner financial dashboard (revenue, outstanding rent, occupancy, maintenance expenses, net profit)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/owner", authorize("owner", "house_manager"), getOwnerDashboardHandler);

/**
 * @openapi
 * /dashboard/tenant:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get the dashboard for the authenticated tenant
 *     responses:
 *       200:
 *         description: Tenant dashboard (active lease, outstanding balance, next due invoice, maintenance requests, unread notifications)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/tenant", authorize("tenant"), getTenantDashboardHandler);

/**
 * @openapi
 * /dashboard/agent:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get the dashboard for the authenticated agent
 *     responses:
 *       200:
 *         description: Agent dashboard (managed properties, active leases, maintenance requests, unread notifications)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/agent", authorize("agent"), getAgentDashboardHandler);

/**
 * @openapi
 * /dashboard/me:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get the dashboard appropriate for the caller's own role (tenant, owner/house manager, agent, or admin/superadmin)
 *     responses:
 *       200:
 *         description: Dashboard data shaped according to the caller's role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/me", getMyDashboardHandler);

/**
 * @openapi
 * /dashboard/admin:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get platform-wide statistics for administrators
 *     responses:
 *       200:
 *         description: Platform-wide dashboard (revenue, users, properties, payments)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to perform this action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/admin", authorize(...ADMIN_ROLES), getAdminDashboardHandler);

/**
 * @openapi
 * /dashboard/admin/statement:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get a platform-wide profit & loss statement (admin only)
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
 *         schema: { type: string, enum: [json, excel, pdf] }
 *     responses:
 *       200:
 *         description: Profit & loss statement (JSON, or a binary xlsx/pdf when format is set)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *           application/pdf:
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
router.get("/admin/statement", authorize(...ADMIN_ROLES), validate(statementQuerySchema), getStatementHandler);

export default router;
