import https from "node:https";
import type { Request, Response } from "express";
import MessageValidator from "sns-validator";
import { sendSuccess } from "../../common/utils/response.util";
import { logger } from "../../config/logger";
import { suppressEmail } from "../../services/emailSuppression.service";

const validator = new MessageValidator();

interface SnsEnvelope {
    Type: string;
    SubscribeURL?: string;
    Message?: string;
    [key: string]: unknown;
}

function validateSnsMessage(body: unknown): Promise<SnsEnvelope> {
    return new Promise((resolve, reject) => {
        validator.validate(body as Record<string, unknown>, (err, message) => {
            if (err || !message) return reject(err ?? new Error("Invalid SNS message"));
            resolve(message as unknown as SnsEnvelope);
        });
    });
}

// SNS requires visiting the SubscribeURL once to activate an HTTPS
// subscription — this is that confirmation, triggered automatically the
// first time SNS delivers to this endpoint after Terraform creates the
// subscription.
function confirmSubscription(subscribeUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https
            .get(subscribeUrl, (res) => {
                res.resume();
                res.on("end", resolve);
            })
            .on("error", reject);
    });
}

interface SesBounceOrComplaintPayload {
    notificationType: "Bounce" | "Complaint" | "Delivery";
    bounce?: {
        bounceType: "Permanent" | "Transient" | "Undetermined";
        bounceSubType: string;
        bouncedRecipients: { emailAddress: string }[];
    };
    complaint?: {
        complaintFeedbackType?: string;
        complainedRecipients: { emailAddress: string }[];
    };
}

/**
 * SES publishes bounce/complaint notifications here (via the SNS topic set
 * up in infra/terraform/ses.tf) so we can stop mailing an address that's
 * already told us — through MTN's own signal, not ours — that it's
 * undeliverable or doesn't want our mail. Only permanent (hard) bounces
 * suppress; transient ones (e.g. a full mailbox) are left alone since
 * they're often temporary. Every complaint suppresses immediately.
 *
 * The signature check below is what stands in for authentication here —
 * SNS can't send our JWTs, so anyone who discovers this URL could otherwise
 * suppress an address of their choosing by posting a fake bounce report.
 */
export async function sesNotificationHandler(req: Request, res: Response) {
    let message: SnsEnvelope;
    try {
        message = await validateSnsMessage(req.body);
    } catch (err) {
        logger.warn({ err }, "Rejected SES/SNS webhook call with an invalid signature");
        return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    if (message.Type === "SubscriptionConfirmation" && message.SubscribeURL) {
        try {
            await confirmSubscription(message.SubscribeURL);
            logger.info("Confirmed SNS subscription for SES bounce/complaint notifications");
        } catch (err) {
            logger.error({ err }, "Failed to confirm SNS subscription for SES notifications");
        }
        return sendSuccess(res, { message: "Subscription confirmed" });
    }

    if (message.Type === "Notification" && message.Message) {
        let payload: SesBounceOrComplaintPayload;
        try {
            payload = JSON.parse(message.Message);
        } catch (err) {
            logger.warn({ err }, "SES notification message was not valid JSON");
            return sendSuccess(res, { message: "Acknowledged" });
        }

        if (payload.notificationType === "Bounce" && payload.bounce?.bounceType === "Permanent") {
            for (const recipient of payload.bounce.bouncedRecipients) {
                await suppressEmail(recipient.emailAddress, "bounce", payload.bounce.bounceSubType);
            }
        } else if (payload.notificationType === "Complaint" && payload.complaint) {
            for (const recipient of payload.complaint.complainedRecipients) {
                await suppressEmail(recipient.emailAddress, "complaint", payload.complaint.complaintFeedbackType);
            }
        }
    }

    return sendSuccess(res, { message: "Acknowledged" });
}
