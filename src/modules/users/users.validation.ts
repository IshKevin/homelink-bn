import { z } from "zod";

export const updateProfileSchema = {
    body: z
        .object({
            firstName: z.string().min(1).optional(),
            lastName: z.string().min(1).optional(),
            phone: z.string().min(5).optional(),
            avatarUrl: z.string().url().optional(),
            // Landlord's own MTN MoMo number — where automated rent
            // disbursements get sent. See payments.schema.ts's `payouts`.
            payoutMomoNumber: z.string().min(5).optional()
        })
        .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" })
};
