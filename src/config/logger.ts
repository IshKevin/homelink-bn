import pino from "pino";
import { env } from "./env";

export const logger = pino({
    level: env.nodeEnv === "test" ? "silent" : "info",
    ...(env.nodeEnv === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
        : {})
});
