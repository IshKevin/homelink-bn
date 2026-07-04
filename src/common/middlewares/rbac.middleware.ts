import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";

export function authorize(...roles: Array<Express.AuthUser["role"]>) {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(AppError.unauthorized());
        }
        if (roles.length > 0 && !roles.includes(req.user.role)) {
            return next(AppError.forbidden("You do not have permission to perform this action"));
        }
        return next();
    };
}
