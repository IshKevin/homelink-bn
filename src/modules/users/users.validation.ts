import { z } from "zod";

export const updateProfileSchema = {
    body: z
        .object({
            firstName: z.string().min(1).max(100).optional(),
            lastName: z.string().min(1).max(100).optional(),
            phone: z.string().min(5).max(30).optional(),
            avatarUrl: z.string().url().max(2048).optional(),
            // Landlord's own MTN MoMo number — where automated rent
            // disbursements get sent. Matches the DB column's varchar(30).
            payoutMomoNumber: z.string().min(5).max(30).optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};
