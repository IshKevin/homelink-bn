import { z } from "zod";

// MTN's callback body — only `status` is required for our purposes; MTN
// sends other fields (financialTransactionId, amount, payer/payee, etc.)
// that we don't currently need to act on.
export const mtnMomoCallbackSchema = {
    params: z.object({
        referenceId: z.string().uuid()
    }),
    body: z.object({
        status: z.enum(["SUCCESSFUL", "FAILED", "PENDING"]),
        reason: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
    })
};
