import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { isEmailSuppressed } from "./emailSuppression.service";

const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: false,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined
});

export interface SendMailInput {
    to: string;
    subject: string;
    html: string;
}

export async function sendMail(input: SendMailInput): Promise<void> {
    if (env.nodeEnv === "test") {
        return;
    }
    if (await isEmailSuppressed(input.to)) {
        logger.warn({ to: input.to }, "Skipped sending — address is suppressed (prior bounce/complaint)");
        return;
    }
    try {
        await transporter.sendMail({
            from: env.smtp.from,
            to: input.to,
            subject: input.subject,
            html: input.html
        });
    } catch (err) {
        logger.error({ err, to: input.to }, "Failed to send email");
    }
}
