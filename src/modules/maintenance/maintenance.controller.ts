import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { buildPaginationMeta, getPagination } from "../../common/utils/pagination.util";
import * as maintenanceService from "./maintenance.service";

export async function createMaintenanceRequestHandler(req: Request, res: Response) {
    const request = await maintenanceService.createMaintenanceRequest(req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Maintenance request submitted", data: request });
}

export async function listMaintenanceRequestsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        status?: "submitted" | "assigned" | "in_progress" | "completed";
        propertyId?: string;
    };

    const { rows, total } = await maintenanceService.listMaintenanceRequests(
        req.user!,
        { status: query.status, propertyId: query.propertyId },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function getMaintenanceRequestHandler(req: Request, res: Response) {
    const request = await maintenanceService.getMaintenanceRequestById(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: request });
}

export async function assignMaintenanceRequestHandler(req: Request, res: Response) {
    const request = await maintenanceService.assignMaintenanceRequest(
        req.params["id"] as string,
        req.user!,
        req.body.assignedTo
    );
    return sendSuccess(res, { message: "Maintenance request assigned", data: request });
}

export async function updateMaintenanceRequestStatusHandler(req: Request, res: Response) {
    const request = await maintenanceService.updateMaintenanceRequestStatus(
        req.params["id"] as string,
        req.user!,
        req.body.status
    );
    return sendSuccess(res, { message: "Maintenance request status updated", data: request });
}

export async function completeMaintenanceRequestHandler(req: Request, res: Response) {
    const request = await maintenanceService.completeMaintenanceRequest(
        req.params["id"] as string,
        req.user!,
        req.body
    );
    return sendSuccess(res, { message: "Maintenance request completed", data: request });
}

export async function submitFeedbackHandler(req: Request, res: Response) {
    const feedback = await maintenanceService.submitFeedback(req.params["id"] as string, req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Feedback submitted", data: feedback });
}

export async function getFeedbackHandler(req: Request, res: Response) {
    const feedback = await maintenanceService.getFeedback(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: feedback ?? null });
}
