import type { Response } from "express";

export interface ApiMeta {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    [key: string]: unknown;
}

export function sendSuccess<T>(res: Response, options: { statusCode?: number; message?: string; data?: T; meta?: ApiMeta }) {
    const { statusCode = 200, message = "Success", data, meta } = options;
    return res.status(statusCode).json({
        success: true,
        message,
        ...(data !== undefined ? { data } : {}),
        ...(meta !== undefined ? { meta } : {})
    });
}
