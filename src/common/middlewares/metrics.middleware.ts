import type { NextFunction, Request, Response } from "express";
import { httpRequestDurationSeconds, httpRequestsTotal } from "../../config/metrics";

// Registered before routing, so req.route is only populated by the time
// "finish" fires — grouping by the route PATTERN (e.g. "/properties/:id"),
// not the raw URL, keeps cardinality bounded regardless of how many actual
// property/lease/etc. ids get hit. Requests that never matched a route
// (typos, bots probing for vulnerabilities) collapse into "unmatched"
// rather than one label per garbage path.
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
        const route = req.route ? `${req.baseUrl}${req.route.path as string}` : "unmatched";
        const labels = { method: req.method, route, status_code: String(res.statusCode) };

        httpRequestsTotal.inc(labels);
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        httpRequestDurationSeconds.observe(labels, durationSeconds);
    });

    next();
}
