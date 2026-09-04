import { z } from "zod";

export const payInvoiceSchema = {
    body: z.object({
        method: z.enum(["mobile_money", "bank_transfer", "cash"]),
        carrier: z.enum(["mtn", "airtel"]).optional(),
        payerPhone: z.string().max(30).optional(),
        payerAccount: z.string().max(100).optional()
    })
};

export const rejectPaymentSchema = {
    body: z.object({
        reason: z.string().min(3).max(5000)
    })
};

export const listInvoicesSchema = {
    query: z.object({
        status: z.enum(["unpaid", "paid", "overdue"]).optional(),
        period: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        leaseId: z.string().uuid().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};

export const listPaymentsSchema = {
    query: z.object({
        status: z.enum(["pending", "success", "failed"]).optional(),
        invoiceId: z.string().uuid().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().optional()
    })
};
