import type { Request } from "express";

export interface PaginationParams {
    page: number;
    limit: number;
    offset: number;
}

export function getPagination(req: Request): PaginationParams {
    const page = Math.max(1, Number(req.query["page"]) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

export function buildPaginationMeta(page: number, limit: number, total: number) {
    return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
    };
}
