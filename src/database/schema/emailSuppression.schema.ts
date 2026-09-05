import { pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const suppressionReasonEnum = pgEnum("suppression_reason", ["bounce", "complaint"]);

// An address lands here from SES's own bounce/complaint SNS notifications
// (see modules/webhooks/ses.webhooks.controller.ts) — sendMail (see
// services/email.service.ts) checks this before every send so we stop
// mailing an address SES itself told us is undeliverable or doesn't want
// our mail, instead of letting our sender reputation take repeated hits.
export const suppressedEmails = pgTable("suppressed_emails", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    reason: suppressionReasonEnum("reason").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
