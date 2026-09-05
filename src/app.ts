import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";

import routes from "./routes";
import { logger } from "./config/logger";
import { swaggerSpec } from "./config/swagger";
import { env } from "./config/env";
import { getApiServers, getEmailServer, getImageServer } from "./config/servers";
import { apiRateLimiter } from "./common/middlewares/rateLimiter.middleware";
import { errorHandler, notFoundHandler } from "./common/middlewares/error.middleware";
import { sendSuccess } from "./common/utils/response.util";
import { httpMetricsMiddleware } from "./common/middlewares/metrics.middleware";
import { metricsRegistry } from "./config/metrics";

const app = express();

// Security & core middlewares
app.use(helmet());
app.use(
    cors(
        env.corsAllowedOrigins.length > 0
            ? { origin: env.corsAllowedOrigins }
            : env.nodeEnv === "production"
              ? { origin: false } // misconfigured (no CORS_ALLOWED_ORIGINS set) — fail closed, not open
              : undefined // dev/test: reflect the request origin so local tooling keeps working
    )
);
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use(apiRateLimiter);
app.use(httpMetricsMiddleware);

// Scraped by Prometheus over this box's private IP only — infra/Caddyfile
// blocks this same path on the public hostname, and the security group
// only allows the jenkins box to reach this port at all (see
// src/config/metrics.ts for the full reasoning).
app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
});

// Root: basic API info so `GET /` doesn't fall through to a bare 404
app.get("/", (_req, res) => {
    sendSuccess(res, {
        message: `${env.appName} API`,
        data: {
            name: env.appName,
            version: "1.0.0",
            docs: "/api-docs",
            health: "/api/v1/health",
            servers: getApiServers("/api/v1"),
            build: env.build,
            admin: env.adminEmail ? { email: env.adminEmail } : null,
            image: getImageServer(),
            email: getEmailServer()
        }
    });
});

// API docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (_req, res) => res.json(swaggerSpec));

// Routes
app.use("/api/v1", routes);

// 404 + error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;