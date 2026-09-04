import pino from "pino";
import { env } from "./env";

export const logger = pino({
    level: env.nodeEnv === "test" ? "silent" : "info",
    // pino-http's default request/response serializers include raw headers —
    // without this, every JWT access token and any session cookie is written
    // to logs in plaintext on every single request.
    redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        remove: true
    },
    ...(env.nodeEnv === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
        : {})
});
