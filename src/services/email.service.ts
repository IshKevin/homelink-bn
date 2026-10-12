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
        const info = await transporter.sendMail({
            from: env.smtp.from,
            to: input.to,
            subject: input.subject,
            html: input.html
        });
        // The SMTP handoff succeeding (no throw) only means the provider
        // accepted the message for delivery, not that it reached the
        // recipient — log its response so a deliverability issue downstream
        // (e.g. an unverified sending domain) is at least visible here
        // instead of looking identical to a real success.
        logger.info({ to: input.to, messageId: info.messageId, response: info.response }, "Email accepted by SMTP server");
    } catch (err) {
        logger.error({ err, to: input.to }, "Failed to send email");
    }
}
