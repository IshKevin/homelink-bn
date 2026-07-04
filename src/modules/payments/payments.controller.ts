import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { buildPaginationMeta, getPagination } from "../../common/utils/pagination.util";
import * as paymentsService from "./payments.service";

export async function listInvoicesHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        status?: "unpaid" | "paid" | "overdue";
        period?: string;
        leaseId?: string;
    };

    const { rows, total } = await paymentsService.listInvoices(
        req.user!,
        { status: query.status, period: query.period, leaseId: query.leaseId },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function getInvoiceHandler(req: Request, res: Response) {
    const invoice = await paymentsService.getInvoiceById(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: invoice });
}

export async function payInvoiceHandler(req: Request, res: Response) {
    const payment = await paymentsService.payInvoice(req.params["id"] as string, req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Payment initiated", data: payment });
}

export async function listPaymentsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        status?: "pending" | "success" | "failed";
        invoiceId?: string;
    };

    const { rows, total } = await paymentsService.listPayments(
        req.user!,
        { status: query.status, invoiceId: query.invoiceId },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function exportPaymentsHandler(req: Request, res: Response) {
    const query = req.query as {
        status?: "pending" | "success" | "failed";
        invoiceId?: string;
    };

    const buffer = await paymentsService.exportPayments(req.user!, {
        status: query.status,
        invoiceId: query.invoiceId
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="payments.xlsx"');
    return res.send(buffer);
}

export async function getReceiptHandler(req: Request, res: Response) {
    const receipt = await paymentsService.getReceipt(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: receipt });
}
