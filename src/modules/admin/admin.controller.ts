import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { buildPaginationMeta, getPagination } from "../../common/utils/pagination.util";
import * as adminService from "./admin.service";

export async function listUsersHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        role?: "tenant" | "owner" | "agent" | "admin";
        isApproved?: "true" | "false";
        isActive?: "true" | "false";
        search?: string;
    };

    const { rows, total } = await adminService.listUsers(
        {
            role: query.role,
            isApproved: query.isApproved,
            isActive: query.isActive,
            search: query.search
        },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function getUserHandler(req: Request, res: Response) {
    const user = await adminService.getUserById(req.params["id"] as string);
    return sendSuccess(res, { data: user });
}

export async function updateUserStatusHandler(req: Request, res: Response) {
    const user = await adminService.updateUserStatus(req.user!.id, req.params["id"] as string, req.body.isActive);
    return sendSuccess(res, { message: "User status updated", data: user });
}

export async function approveAgentHandler(req: Request, res: Response) {
    const user = await adminService.approveAgent(req.user!.id, req.params["id"] as string);
    return sendSuccess(res, { message: "Agent approved", data: user });
}

export async function listIdentityVerificationsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as { status?: "pending" | "approved" | "rejected" };

    const { rows, total } = await adminService.listIdentityVerifications(
        { status: query.status },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function approveIdentityVerificationHandler(req: Request, res: Response) {
    const verification = await adminService.approveIdentityVerification(req.user!.id, req.params["id"] as string);
    return sendSuccess(res, { message: "Identity verification approved", data: verification });
}

export async function rejectIdentityVerificationHandler(req: Request, res: Response) {
    const verification = await adminService.rejectIdentityVerification(
        req.user!.id,
        req.params["id"] as string,
        req.body.reviewNotes
    );
    return sendSuccess(res, { message: "Identity verification rejected", data: verification });
}

export async function deactivatePropertyHandler(req: Request, res: Response) {
    const property = await adminService.deactivateProperty(req.user!.id, req.params["id"] as string, req.body.reason);
    return sendSuccess(res, { message: "Property deactivated", data: property });
}

export async function reactivatePropertyHandler(req: Request, res: Response) {
    const property = await adminService.reactivateProperty(req.user!.id, req.params["id"] as string);
    return sendSuccess(res, { message: "Property reactivated", data: property });
}

export async function getSettingsHandler(_req: Request, res: Response) {
    const settings = await adminService.getSettings();
    return sendSuccess(res, { data: settings });
}

export async function upsertSettingHandler(req: Request, res: Response) {
    const setting = await adminService.upsertSetting(req.user!.id, req.params["key"] as string, req.body.value);
    return sendSuccess(res, { message: "Platform setting saved", data: setting });
}

export async function listAuditLogsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as { userId?: string; entity?: string; action?: string };

    const { rows, total } = await adminService.listAuditLogs(
        { userId: query.userId, entity: query.entity, action: query.action },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function createHouseOwnerHandler(req: Request, res: Response) {
    const owner = await adminService.createHouseOwner(req.user!.id, req.body);
    return sendSuccess(res, { statusCode: 201, message: "House owner created", data: owner });
}

export async function listSuspensionRequestsHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as { status?: "pending" | "approved" | "rejected" };

    const { rows, total } = await adminService.listSuspensionRequests({ status: query.status }, { limit, offset });

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function approveSuspensionRequestHandler(req: Request, res: Response) {
    const request = await adminService.approveSuspensionRequest(
        req.user!.id,
        req.params["id"] as string,
        req.body?.decisionNotes
    );
    return sendSuccess(res, { message: "Suspension request approved", data: request });
}

export async function rejectSuspensionRequestHandler(req: Request, res: Response) {
    const request = await adminService.rejectSuspensionRequest(
        req.user!.id,
        req.params["id"] as string,
        req.body.decisionNotes
    );
    return sendSuccess(res, { message: "Suspension request rejected", data: request });
}
