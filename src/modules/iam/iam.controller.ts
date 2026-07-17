import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { getPagination } from "../../common/utils/pagination.util";
import * as iamService from "./iam.service";

export async function inviteManagerHandler(req: Request, res: Response) {
    const invite = await iamService.inviteManager(req.user!, req.body.email);
    return sendSuccess(res, { statusCode: 201, message: "Manager invite sent", data: invite });
}

export async function inviteTenantHandler(req: Request, res: Response) {
    const invite = await iamService.inviteTenant(req.user!, req.body.email, req.body.propertyId);
    return sendSuccess(res, { statusCode: 201, message: "Tenant invite sent", data: invite });
}

export async function listInvitesHandler(req: Request, res: Response) {
    const { limit, offset } = getPagination(req);
    const invitesList = await iamService.listInvites(req.user!, { limit, offset });
    return sendSuccess(res, { data: invitesList });
}

export async function listManagersHandler(req: Request, res: Response) {
    const managers = await iamService.listManagers(req.user!);
    return sendSuccess(res, { data: managers });
}

export async function revokeManagerHandler(req: Request, res: Response) {
    const assignment = await iamService.revokeManager(req.params["id"] as string, req.user!);
    return sendSuccess(res, { message: "Manager access revoked", data: assignment });
}

export async function acceptInviteHandler(req: Request, res: Response) {
    const user = await iamService.acceptInvite(req.body);
    return sendSuccess(res, { statusCode: 201, message: "Account created, please log in", data: user });
}

export async function createSuspensionRequestHandler(req: Request, res: Response) {
    const request = await iamService.createSuspensionRequest(req.user!, req.body.targetUserId, req.body.reason);
    return sendSuccess(res, { statusCode: 201, message: "Suspension request submitted", data: request });
}
