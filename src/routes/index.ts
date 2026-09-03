import { Router } from "express";
import { sendSuccess } from "../common/utils/response.util";
import authRoutes from "../modules/auth/auth.routes";
import usersRoutes from "../modules/users/users.routes";
import propertiesRoutes from "../modules/properties/properties.routes";
import leasesRoutes from "../modules/leases/leases.routes";
import { invoicesRouter, paymentsRouter } from "../modules/payments/payments.routes";
import maintenanceRoutes from "../modules/maintenance/maintenance.routes";
import notificationsRoutes from "../modules/notifications/notifications.routes";
import adminRoutes from "../modules/admin/admin.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import reportsRoutes from "../modules/reports/reports.routes";
import iamRoutes from "../modules/iam/iam.routes";
import leadsRoutes from "../modules/leads/leads.routes";
import webhooksRoutes from "../modules/payments/webhooks.routes";

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     security: []
 *     responses:
 *       200:
 *         description: API is running
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/health", (_req, res) => {
    sendSuccess(res, { message: "HomeLink API is running", data: { status: "ok" } });
});

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/properties", propertiesRoutes);
router.use("/leases", leasesRoutes);
router.use("/invoices", invoicesRouter);
router.use("/payments", paymentsRouter);
router.use("/maintenance-requests", maintenanceRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/admin", adminRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/reports", reportsRoutes);
router.use("/iam", iamRoutes);
router.use("/leads", leadsRoutes);
router.use("/webhooks", webhooksRoutes);

export default router;