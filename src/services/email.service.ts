import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "../config/logger";

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
