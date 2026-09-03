import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "../../database";
import { invoices, leases, payments } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { getPaymentProvider } from "../../services/payments/payment.service";
import { renderHtmlToPdf } from "../../services/pdf.service";
import { buildObjectKey, getPresignedDownloadUrl, uploadBuffer } from "../../services/storage.service";
import { buildExcelBuffer, type ExcelColumn } from "../../services/excel.service";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";
import { publishPaymentSucceeded } from "../../services/events/eventBridge.service";
import { isAdminRole, resolveEffectiveOwnerId } from "../../services/iam.service";
import { nextDocumentNumber } from "../../common/utils/sequence.util";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type InvoiceRow = typeof invoices.$inferSelect;
type LeaseRow = typeof leases.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

export interface ListInvoicesFilters {
    status?: InvoiceRow["status"] | undefined;
    period?: string | undefined;
    leaseId?: string | undefined;
}

export interface ListPaymentsFilters {
    status?: PaymentRow["status"] | undefined;
    invoiceId?: string | undefined;
}

export interface PayInvoiceInput {
    method: "mobile_money" | "bank_transfer" | "cash";
    carrier?: "mtn" | "airtel" | undefined;
    payerPhone?: string | undefined;
    payerAccount?: string | undefined;
}

async function assertInvoiceAccess(lease: LeaseRow, requester: Requester): Promise<void> {
    if (isAdminRole(requester.role) || requester.id === lease.tenantId || requester.id === lease.ownerId) return;
    if (requester.role === "house_manager" && lease.ownerId === (await resolveEffectiveOwnerId(requester))) return;
    throw AppError.forbidden("You do not have permission to access this invoice");
}

async function assertLeaseOwnerAccess(lease: LeaseRow, requester: Requester): Promise<void> {
    if (isAdminRole(requester.role) || requester.id === lease.ownerId) return;
    if (requester.role === "house_manager" && lease.ownerId === (await resolveEffectiveOwnerId(requester))) return;
    throw AppError.forbidden("You do not have permission to act on this payment");
}

async function getInvoiceWithLeaseOrThrow(invoiceId: string): Promise<{ invoice: InvoiceRow; lease: LeaseRow }> {
    const [row] = await db
        .select({ invoice: invoices, lease: leases })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(eq(invoices.id, invoiceId))
        .limit(1);

    if (!row) throw AppError.notFound("Invoice not found");
    return row;
}

function buildReceiptHtml(payment: PaymentRow, invoice: InvoiceRow): string {
    return `
        <html>
            <head>
                <meta charset="utf-8" />
                <title>Payment Receipt</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 24px; }
                    h1 { font-size: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                    td { padding: 8px; border-bottom: 1px solid #ddd; }
                    td:first-child { font-weight: bold; width: 200px; }
                </style>
            </head>
            <body>
                <h1>Payment Receipt</h1>
                <table>
                    <tr><td>Receipt No.</td><td>${payment.paymentNumber}</td></tr>
                    <tr><td>Invoice No.</td><td>${invoice.invoiceNumber}</td></tr>
                    <tr><td>Invoice Period</td><td>${invoice.period}</td></tr>
                    <tr><td>Amount</td><td>${payment.amount}</td></tr>
                    <tr><td>Method</td><td>${payment.method}</td></tr>
                    <tr><td>Provider Reference</td><td>${payment.providerReference}</td></tr>
                    <tr><td>Status</td><td>${payment.status}</td></tr>
                    <tr><td>Paid At</td><td>${payment.paidAt ? payment.paidAt.toISOString() : ""}</td></tr>
                </table>
            </body>
        </html>
    `;
}

export async function listInvoices(
    requester: Requester,
    filters: ListInvoicesFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];
    if (filters.status) conditions.push(eq(invoices.status, filters.status));
    if (filters.period) conditions.push(eq(invoices.period, filters.period));
    if (filters.leaseId) conditions.push(eq(invoices.leaseId, filters.leaseId));

    if (requester.role === "tenant") {
        conditions.push(eq(leases.tenantId, requester.id));
    } else if (requester.role === "owner") {
        conditions.push(eq(leases.ownerId, requester.id));
    } else if (requester.role === "house_manager") {
        conditions.push(eq(leases.ownerId, await resolveEffectiveOwnerId(requester)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(where);

    const rows = await db
        .select({ invoice: invoices })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(where)
        .orderBy(desc(invoices.dueDate))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows: rows.map((r) => r.invoice), total: countRow?.count ?? 0 };
}

export async function getInvoiceById(invoiceId: string, requester: Requester) {
    const { invoice, lease } = await getInvoiceWithLeaseOrThrow(invoiceId);
    await assertInvoiceAccess(lease, requester);
    return invoice;
}

export async function markPaymentSuccess(paymentId: string): Promise<PaymentRow> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw AppError.notFound("Payment not found");

    // Idempotent: MTN's webhook can retry delivery, and a webhook can race a
    // status-poll fallback — do the receipt/notify/event work only once.
    if (payment.status === "success") return payment;

    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
    if (!invoice) throw AppError.notFound("Invoice not found");

    const html = buildReceiptHtml(payment, invoice);
    const buffer = await renderHtmlToPdf(html);
    const key = buildObjectKey("receipts", `${payment.id}.pdf`);
    await uploadBuffer(key, buffer, "application/pdf");

    const now = new Date();
    const [updated] = await db
        .update(payments)
        .set({ status: "success", receiptUrl: key, paidAt: now })
        .where(eq(payments.id, payment.id))
        .returning();
    await db.update(invoices).set({ status: "paid", updatedAt: now }).where(eq(invoices.id, invoice.id));

    const [lease] = await db.select().from(leases).where(eq(leases.id, invoice.leaseId)).limit(1);

    await notify({
        userId: payment.tenantId,
        type: "payment.success",
        title: "Payment successful",
        message: `Your payment of ${invoice.amountDue} for invoice period ${invoice.period} was successful.`,
        metadata: { invoiceId: invoice.id, paymentId: payment.id },
        sendEmail: true
    });
    if (lease) {
        await notify({
            userId: lease.ownerId,
            type: "payment.success",
            title: "Payment received",
            message: `A payment of ${invoice.amountDue} was received for invoice period ${invoice.period}.`,
            metadata: { invoiceId: invoice.id, paymentId: payment.id },
            sendEmail: true
        });

        // Kicks off the automated landlord disbursement — see
        // services/events/eventBridge.service.ts and
        // jobs/handlers/processPayoutEvents.job.ts. Fully decoupled: this
        // request doesn't wait on it, and its failure doesn't affect the
        // payment that already succeeded.
        await publishPaymentSucceeded({
            paymentId: payment.id,
            invoiceId: invoice.id,
            leaseId: lease.id,
            ownerId: lease.ownerId,
            tenantId: payment.tenantId,
            amount: payment.amount
        });
    }

    return updated ?? payment;
}

/** Webhook-driven failure path — see markPaymentSuccess's idempotency note. */
export async function markPaymentFailed(paymentId: string, reason: string): Promise<PaymentRow> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw AppError.notFound("Payment not found");
    if (payment.status !== "pending") return payment;

    const [updated] = await db
        .update(payments)
        .set({ status: "failed", failureReason: reason })
        .where(eq(payments.id, payment.id))
        .returning();

    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
    await notify({
        userId: payment.tenantId,
        type: "payment.failed",
        title: "Payment failed",
        message: `Your payment${invoice ? ` for invoice period ${invoice.period}` : ""} failed: ${reason}.`,
        metadata: { paymentId: payment.id },
        sendEmail: true
    });

    return updated ?? payment;
}

export async function payInvoice(invoiceId: string, tenant: Requester, input: PayInvoiceInput) {
    const { invoice, lease } = await getInvoiceWithLeaseOrThrow(invoiceId);

    if (tenant.id !== lease.tenantId) {
        throw AppError.forbidden("Only the tenant on this lease may pay this invoice");
    }

    if (invoice.status === "paid") {
        throw AppError.conflict("Invoice is already paid");
    }

    if (input.method === "cash" || input.method === "bank_transfer") {
        const paymentNumber = await nextDocumentNumber("ACC-PAY");
        const [payment] = await db
            .insert(payments)
            .values({
                paymentNumber,
                invoiceId: invoice.id,
                tenantId: tenant.id,
                amount: invoice.amountDue,
                method: input.method,
                provider: input.method,
                providerReference: `MANUAL-${crypto.randomUUID()}`,
                status: "pending",
                approvalStatus: "pending"
            })
            .returning();

        if (!payment) throw AppError.internal("Failed to create payment");

        await recordAction({
            userId: tenant.id,
            action: "payment.initiate",
            entity: "payment",
            entityId: payment.id,
            metadata: { status: payment.status, method: input.method }
        });

        await notify({
            userId: lease.ownerId,
            type: "payment.approval_requested",
            title: "Payment awaiting your approval",
            message: `A ${input.method.replace("_", " ")} payment of ${invoice.amountDue} for invoice period ${invoice.period} needs your approval.`,
            metadata: { invoiceId: invoice.id, paymentId: payment.id },
            sendEmail: true
        });

        return payment;
    }

    const provider = getPaymentProvider(input.method, input.carrier);
    const result = await provider.initiate({
        amount: Number(invoice.amountDue),
        reference: invoice.invoiceNumber,
        // Falls back to the number saved on the lease at signing time, so a
        // tenant paying with their usual number doesn't have to re-supply it
        // on every request.
        payerPhone: input.payerPhone || lease.momoNumber || undefined,
        payerAccount: input.payerAccount
    });

    const paymentNumber = await nextDocumentNumber("ACC-PAY");
    const [payment] = await db
        .insert(payments)
        .values({
            paymentNumber,
            invoiceId: invoice.id,
            tenantId: tenant.id,
            amount: invoice.amountDue,
            method: input.method,
            provider: provider.name,
            providerReference: result.providerReference,
            status: result.status,
            approvalStatus: "not_required",
            failureReason: result.failureReason
        })
        .returning();

    if (!payment) throw AppError.internal("Failed to create payment");

    let finalPayment: PaymentRow = payment;

    if (result.status === "success") {
        finalPayment = await markPaymentSuccess(payment.id);
    } else if (result.status === "failed") {
        await notify({
            userId: lease.tenantId,
            type: "payment.failed",
            title: "Payment failed",
            message: `Your payment of ${invoice.amountDue} for invoice period ${invoice.period} failed${result.failureReason ? `: ${result.failureReason}` : ""}.`,
            metadata: { invoiceId: invoice.id, paymentId: payment.id },
            sendEmail: true
        });
    }

    await recordAction({
        userId: tenant.id,
        action: "payment.initiate",
        entity: "payment",
        entityId: payment.id,
        metadata: { status: result.status }
    });

    return finalPayment;
}

export async function approvePayment(paymentId: string, requester: Requester) {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw AppError.notFound("Payment not found");

    const { lease } = await getInvoiceWithLeaseOrThrow(payment.invoiceId);
    await assertLeaseOwnerAccess(lease, requester);

    if (payment.approvalStatus !== "pending") {
        throw AppError.conflict("Payment is not awaiting approval");
    }

    const now = new Date();
    await db
        .update(payments)
        .set({ approvalStatus: "approved", approvedBy: requester.id, approvedAt: now })
        .where(eq(payments.id, paymentId));

    const updated = await markPaymentSuccess(paymentId);

    await recordAction({
        userId: requester.id,
        action: "payment.approve",
        entity: "payment",
        entityId: paymentId
    });

    return updated;
}

export async function rejectPayment(paymentId: string, requester: Requester, reason: string) {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw AppError.notFound("Payment not found");

    const { lease, invoice } = await getInvoiceWithLeaseOrThrow(payment.invoiceId);
    await assertLeaseOwnerAccess(lease, requester);

    if (payment.approvalStatus !== "pending") {
        throw AppError.conflict("Payment is not awaiting approval");
    }

    const [updated] = await db
        .update(payments)
        .set({
            status: "failed",
            approvalStatus: "rejected",
            approvedBy: requester.id,
            approvedAt: new Date(),
            failureReason: reason
        })
        .where(eq(payments.id, paymentId))
        .returning();

    if (!updated) throw AppError.internal("Failed to reject payment");

    await recordAction({
        userId: requester.id,
        action: "payment.reject",
        entity: "payment",
        entityId: paymentId,
        metadata: { reason }
    });

    await notify({
        userId: payment.tenantId,
        type: "payment.rejected",
        title: "Payment rejected",
        message: `Your payment of ${invoice.amountDue} for invoice period ${invoice.period} was rejected: ${reason}`,
        metadata: { invoiceId: invoice.id, paymentId },
        sendEmail: true
    });

    return updated;
}

export async function listPayments(
    requester: Requester,
    filters: ListPaymentsFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];
    if (filters.status) conditions.push(eq(payments.status, filters.status));
    if (filters.invoiceId) conditions.push(eq(payments.invoiceId, filters.invoiceId));

    if (requester.role === "tenant") {
        conditions.push(eq(payments.tenantId, requester.id));
    } else if (requester.role === "owner") {
        conditions.push(eq(leases.ownerId, requester.id));
    } else if (requester.role === "house_manager") {
        conditions.push(eq(leases.ownerId, await resolveEffectiveOwnerId(requester)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(where);

    const rows = await db
        .select({ payment: payments })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(where)
        .orderBy(desc(payments.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows: rows.map((r) => r.payment), total: countRow?.count ?? 0 };
}

export async function exportPayments(requester: Requester, filters: ListPaymentsFilters): Promise<Buffer> {
    const conditions = [];
    if (filters.status) conditions.push(eq(payments.status, filters.status));
    if (filters.invoiceId) conditions.push(eq(payments.invoiceId, filters.invoiceId));

    if (requester.role === "tenant") {
        conditions.push(eq(payments.tenantId, requester.id));
    } else if (requester.role === "owner") {
        conditions.push(eq(leases.ownerId, requester.id));
    } else if (requester.role === "house_manager") {
        conditions.push(eq(leases.ownerId, await resolveEffectiveOwnerId(requester)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
        .select({ payment: payments })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(where)
        .orderBy(desc(payments.createdAt))
        .limit(5000);

    const columns: ExcelColumn[] = [
        { header: "Payment Number", key: "PaymentNumber", width: 22 },
        { header: "Date", key: "Date", width: 15 },
        { header: "Amount", key: "Amount", width: 15 },
        { header: "Method", key: "Method", width: 18 },
        { header: "Status", key: "Status", width: 12 },
        { header: "Reference", key: "Reference", width: 30 }
    ];

    const exportRows = rows.map((r) => ({
        PaymentNumber: r.payment.paymentNumber,
        Date: format(r.payment.createdAt, "yyyy-MM-dd"),
        Amount: r.payment.amount,
        Method: r.payment.method,
        Status: r.payment.status,
        Reference: r.payment.providerReference
    }));

    return buildExcelBuffer("Payments", columns, exportRows);
}

export async function getReceipt(paymentId: string, requester: Requester) {
    const [row] = await db
        .select({ payment: payments, invoice: invoices, lease: leases })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(eq(payments.id, paymentId))
        .limit(1);

    if (!row) throw AppError.notFound("Payment not found");

    await assertInvoiceAccess(row.lease, requester);

    if (row.payment.status !== "success" || !row.payment.receiptUrl) {
        throw AppError.notFound("Receipt not available for this payment");
    }

    return { url: await getPresignedDownloadUrl(row.payment.receiptUrl) };
}
