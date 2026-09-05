import rateLimit from "express-rate-limit";
import { env } from "../../config/env";

// Integration tests share one in-memory limiter per test file (module cache
// is per-file, not per-test) and fire far more than 20 requests against
// these same routes — rate limiting a real concern in production only, not
// something a test run should trip over.
const skipInTest = () => env.nodeEnv === "test";

export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: "Too many requests, please try again later" }
});

export const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: "Too many requests, please try again later" }
});

export const leadsRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: "Too many requests, please try again later" }
});
