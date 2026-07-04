import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { listNotificationsSchema } from "./notifications.validation";
import {
    getUnreadCountHandler,
    listNotificationsHandler,
    markAllAsReadHandler,
    markAsReadHandler
} from "./notifications.controller";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List the current user's notifications
 *     parameters:
 *       - in: query
 *         name: isRead
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of the current user's notifications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.get("/", validate(listNotificationsSchema), listNotificationsHandler);

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get the count of the current user's unread notifications
 *     responses:
 *       200:
 *         description: Unread notification count
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/unread-count", getUnreadCountHandler);

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a single notification as read (idempotent)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to access this notification
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       404:
 *         description: Notification not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/:id/read", markAsReadHandler);

/**
 * @openapi
 * /notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all of the current user's unread notifications as read
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.patch("/read-all", markAllAsReadHandler);

export default router;
