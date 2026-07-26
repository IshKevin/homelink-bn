import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { getPagination, buildPaginationMeta } from "../../common/utils/pagination.util";
import * as leadsService from "./leads.service";

export async function submitContactHandler(req: Request, res: Response) {
    const lead = await leadsService.submitContact(req.body);
    return sendSuccess(res, { statusCode: 201, message: "Message sent", data: lead });
}

export async function submitGetStartedHandler(req: Request, res: Response) {
    const lead = await leadsService.submitGetStarted(req.body);
    return sendSuccess(res, { statusCode: 201, message: "Request submitted", data: lead });
}

export async function listLeadsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        type?: "contact" | "get_started";
        status?: "new" | "contacted" | "converted" | "dismissed";
    };

    const { rows, total } = await leadsService.listLeads(
        { type: query.type, status: query.status },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function updateLeadStatusHandler(req: Request, res: Response) {
    const lead = await leadsService.updateLeadStatus(req.params["id"] as string, req.body.status);
    return sendSuccess(res, { message: "Lead status updated", data: lead });
}
