import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { buildPaginationMeta, getPagination } from "../../common/utils/pagination.util";
import * as notificationsService from "./notifications.service";

export async function listNotificationsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as { isRead?: "true" | "false" };

    const { rows, total } = await notificationsService.listNotifications(
        req.user!.id,
        { isRead: query.isRead },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function getUnreadCountHandler(req: Request, res: Response) {
    const unreadCount = await notificationsService.getUnreadCount(req.user!.id);
    return sendSuccess(res, { data: { unreadCount } });
}

export async function markAsReadHandler(req: Request, res: Response) {
    const notification = await notificationsService.markAsRead(req.params["id"] as string, req.user!.id);
    return sendSuccess(res, { message: "Notification marked as read", data: notification });
}

export async function markAllAsReadHandler(req: Request, res: Response) {
    const result = await notificationsService.markAllAsRead(req.user!.id);
    return sendSuccess(res, { message: "All notifications marked as read", data: result });
}
