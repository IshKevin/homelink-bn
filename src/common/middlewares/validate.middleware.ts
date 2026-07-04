import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export interface RequestSchema {
    body?: ZodType;
    params?: ZodType;
    query?: ZodType;
}

export function validate(schema: RequestSchema) {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (schema.body) {
            req.body = schema.body.parse(req.body);
        }
        if (schema.params) {
            Object.assign(req.params, schema.params.parse(req.params));
        }
        if (schema.query) {
            Object.assign(req.query, schema.query.parse(req.query));
        }
        next();
    };
}
