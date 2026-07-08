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
import { getApiServers } from "./config/servers";
import { apiRateLimiter } from "./common/middlewares/rateLimiter.middleware";
import { errorHandler, notFoundHandler } from "./common/middlewares/error.middleware";
import { sendSuccess } from "./common/utils/response.util";

const app = express();

// Security & core middlewares
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use(apiRateLimiter);

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
            admin: env.adminEmail ? { email: env.adminEmail } : null
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