import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import * as authService from "./auth.service";

export async function registerHandler(req: Request, res: Response) {
    const result = await authService.register(req.body);
    return sendSuccess(res, { statusCode: 201, message: "Registration successful", data: result });
}

export async function loginHandler(req: Request, res: Response) {
    const result = await authService.login(req.body.email, req.body.password);
    return sendSuccess(res, { message: "Login successful", data: result });
}

export async function refreshHandler(req: Request, res: Response) {
    const result = await authService.refresh(req.body.refreshToken);
    return sendSuccess(res, { message: "Token refreshed", data: result });
}

export async function logoutHandler(req: Request, res: Response) {
    await authService.logout(req.body.refreshToken);
    return sendSuccess(res, { message: "Logged out successfully" });
}

export async function forgotPasswordHandler(req: Request, res: Response) {
    await authService.forgotPassword(req.body.email);
    return sendSuccess(res, { message: "If that email exists, a reset link has been sent" });
}

export async function resetPasswordHandler(req: Request, res: Response) {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    return sendSuccess(res, { message: "Password reset successfully" });
}
