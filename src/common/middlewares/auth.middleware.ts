import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";
import { verifyAccessToken } from "../utils/jwt.util";

export function authenticate(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next(AppError.unauthorized("Missing or invalid authorization header"));
    }

    const token = header.slice("Bearer ".length);
    try {
        const payload = verifyAccessToken(token);
        req.user = { id: payload.sub, role: payload.role as Express.AuthUser["role"], email: payload.email };
        return next();
    } catch {
        return next(AppError.unauthorized("Invalid or expired access token"));
    }
}
