import { db } from "../database";
import { notifications, users } from "../database/schema";
import { eq } from "drizzle-orm";
import { sendMail } from "./email.service";
import { genericNotificationTemplate } from "./email.templates";
import { logger } from "../config/logger";

export interface NotifyInput {
    userId: string;
    type: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
    sendEmail?: boolean;
}

export async function notify(input: NotifyInput): Promise<void> {
    await db.insert(notifications).values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata
    });

    if (input.sendEmail) {
        const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (user) {
            await sendMail({
                to: user.email,
                subject: input.title,
                html: genericNotificationTemplate(user.firstName, input.message)
            }).catch((err) => logger.error({ err }, "notification email failed"));
        }
    }
}
