import type { Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";
import { sendSuccess } from "../../common/utils/response.util";
import * as usersService from "./users.service";

export async function getMeHandler(req: Request, res: Response) {
    const user = await usersService.getById(req.user!.id);
    return sendSuccess(res, { data: user });
}

export async function updateMeHandler(req: Request, res: Response) {
    const user = await usersService.updateProfile(req.user!.id, req.body);
    return sendSuccess(res, { message: "Profile updated", data: user });
}

export async function submitVerificationHandler(req: Request, res: Response) {
    if (!req.file) {
        throw AppError.badRequest("A document file is required");
    }
    const verification = await usersService.submitIdentityVerification(req.user!.id, req.file);
    return sendSuccess(res, { statusCode: 201, message: "Verification submitted for review", data: verification });
}

export async function getMyVerificationsHandler(req: Request, res: Response) {
    const verifications = await usersService.getMyVerifications(req.user!.id);
    return sendSuccess(res, { data: verifications });
}
