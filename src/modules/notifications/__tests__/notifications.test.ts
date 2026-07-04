import { eq } from "drizzle-orm";
import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { notifications } from "../../../database/schema";

interface CreateNotificationOverrides {
    userId: string;
    type?: string;
    title?: string;
    message?: string;
    isRead?: boolean;
    metadata?: Record<string, unknown>;
}

async function createNotification(overrides: CreateNotificationOverrides) {
    const [notification] = await db
        .insert(notifications)
        .values({
            userId: overrides.userId,
            type: overrides.type ?? "maintenance.submitted",
            title: overrides.title ?? "Test notification",
            message: overrides.message ?? "This is a test notification.",
            isRead: overrides.isRead ?? false,
            metadata: overrides.metadata
        })
        .returning();

    if (!notification) throw new Error("Failed to create test notification");
    return notification;
}

describe("Notifications module", () => {
    describe("GET /api/v1/notifications", () => {
        it("allows a user to list their own notifications with pagination meta", async () => {
            const { user, accessToken } = await createAuthedUser();
            await createNotification({ userId: user.id, title: "First" });
            await createNotification({ userId: user.id, title: "Second" });

            const res = await testRequest().get("/api/v1/notifications").set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
        });

        it("filters by isRead=false to return only unread notifications", async () => {
            const { user, accessToken } = await createAuthedUser();
            await createNotification({ userId: user.id, title: "Unread", isRead: false });
            await createNotification({ userId: user.id, title: "Read", isRead: true });

            const res = await testRequest()
                .get("/api/v1/notifications")
                .query({ isRead: "false" })
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].title).toBe("Unread");
        });

        it("does not return another user's notifications", async () => {
            const { user: otherUser } = await createAuthedUser();
            await createNotification({ userId: otherUser.id, title: "Not mine" });

            const { accessToken } = await createAuthedUser();
            const res = await testRequest().get("/api/v1/notifications").set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(0);
        });
    });

    describe("GET /api/v1/notifications/unread-count", () => {
        it("returns the count of unread notifications for the current user", async () => {
            const { user, accessToken } = await createAuthedUser();
            await createNotification({ userId: user.id, isRead: false });
            await createNotification({ userId: user.id, isRead: false });
            await createNotification({ userId: user.id, isRead: true });

            const res = await testRequest()
                .get("/api/v1/notifications/unread-count")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.unreadCount).toBe(2);
        });
    });

    describe("PATCH /api/v1/notifications/:id/read", () => {
        it("marks a notification as read, and is idempotent when already read", async () => {
            const { user, accessToken } = await createAuthedUser();
            const notification = await createNotification({ userId: user.id, isRead: false });

            const res = await testRequest()
                .patch(`/api/v1/notifications/${notification.id}/read`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.isRead).toBe(true);

            const secondRes = await testRequest()
                .patch(`/api/v1/notifications/${notification.id}/read`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(secondRes.status).toBe(200);
            expect(secondRes.body.data.isRead).toBe(true);
        });

        it("forbids marking another user's notification as read", async () => {
            const { user: owner } = await createAuthedUser();
            const notification = await createNotification({ userId: owner.id });

            const { accessToken } = await createAuthedUser();
            const res = await testRequest()
                .patch(`/api/v1/notifications/${notification.id}/read`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(403);
        });

        it("returns 404 for a non-existent notification", async () => {
            const { accessToken } = await createAuthedUser();
            const res = await testRequest()
                .patch("/api/v1/notifications/00000000-0000-0000-0000-000000000000/read")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe("PATCH /api/v1/notifications/read-all", () => {
        it("marks all of the caller's unread notifications as read and leaves other users' untouched", async () => {
            const { user, accessToken } = await createAuthedUser();
            const first = await createNotification({ userId: user.id, isRead: false });
            const second = await createNotification({ userId: user.id, isRead: false });

            const { user: otherUser } = await createAuthedUser();
            const otherNotification = await createNotification({ userId: otherUser.id, isRead: false });

            const res = await testRequest()
                .patch("/api/v1/notifications/read-all")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.updated).toBe(2);

            const listRes = await testRequest().get("/api/v1/notifications").set("Authorization", `Bearer ${accessToken}`);
            const byId = new Map(listRes.body.data.map((n: { id: string; isRead: boolean }) => [n.id, n.isRead]));
            expect(byId.get(first.id)).toBe(true);
            expect(byId.get(second.id)).toBe(true);

            const [refreshedOther] = await db.select().from(notifications).where(eq(notifications.id, otherNotification.id));
            expect(refreshedOther?.isRead).toBe(false);
        });
    });
});
