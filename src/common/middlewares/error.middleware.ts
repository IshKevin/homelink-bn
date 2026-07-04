import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";
import { logger } from "../../config/logger";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
    next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        });
    }

    if (err instanceof AppError) {
        if (!err.isOperational) {
            logger.error({ err }, "Non-operational AppError");
        }
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            ...(err.errors ? { errors: err.errors } : {})
        });
    }

    logger.error({ err, path: req.originalUrl }, "Unhandled error");
    return res.status(500).json({
        success: false,
        message: "Internal server error"
    });
}
