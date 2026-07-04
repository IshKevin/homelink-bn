import { z } from "zod";

export const listNotificationsSchema = {
    query: z.object({
        isRead: z.enum(["true", "false"]).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
