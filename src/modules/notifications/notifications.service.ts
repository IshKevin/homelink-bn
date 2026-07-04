import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../database";
import { notifications } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";

type NotificationRow = typeof notifications.$inferSelect;

export interface ListNotificationsFilters {
    isRead?: string | undefined;
}

async function getNotificationOrThrow(notificationId: string): Promise<NotificationRow> {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
    if (!notification) throw AppError.notFound("Notification not found");
    return notification;
}

export async function listNotifications(
    userId: string,
    filters: ListNotificationsFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [eq(notifications.userId, userId)];
    if (filters.isRead !== undefined) {
        conditions.push(eq(notifications.isRead, filters.isRead === "true"));
    }

    const where = and(...conditions);

    const [countRow] = await db.select({ count: count() }).from(notifications).where(where);

    const rows = await db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

export async function getUnreadCount(userId: string): Promise<number> {
    const [countRow] = await db
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

    return countRow?.count ?? 0;
}

export async function markAsRead(notificationId: string, userId: string) {
    const notification = await getNotificationOrThrow(notificationId);

    if (notification.userId !== userId) {
        throw AppError.forbidden("You do not have permission to access this notification");
    }

    if (notification.isRead) {
        return notification;
    }

    const [updated] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notificationId))
        .returning();

    if (!updated) throw AppError.internal("Failed to mark notification as read");

    return updated;
}

export async function markAllAsRead(userId: string) {
    const result = await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
        .returning({ id: notifications.id });

    return { updated: result.length };
}
