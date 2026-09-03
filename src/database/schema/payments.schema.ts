import { date, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.schema";
import { leases } from "./leases.schema";

export const invoiceStatusEnum = pgEnum("invoice_status", ["unpaid", "paid", "overdue"]);
export const paymentMethodEnum = pgEnum("payment_method", ["mobile_money", "bank_transfer", "cash"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "success", "failed"]);
export const paymentApprovalStatusEnum = pgEnum("payment_approval_status", [
    "not_required",
    "pending",
    "approved",
    "rejected"
]);
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "success", "failed"]);

export const invoices = pgTable("invoices", {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: varchar("invoice_number", { length: 30 }).notNull().unique(),
    leaseId: uuid("lease_id")
        .notNull()
        .references(() => leases.id, { onDelete: "cascade" }),
    period: varchar("period", { length: 7 }).notNull(),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 }).notNull(),
    dueDate: date("due_date").notNull(),
    status: invoiceStatusEnum("status").notNull().default("unpaid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const payments = pgTable("payments", {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentNumber: varchar("payment_number", { length: 30 }).notNull().unique(),
    invoiceId: uuid("invoice_id")
        .notNull()
        .references(() => invoices.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
        .notNull()
        .references(() => users.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    providerReference: varchar("provider_reference", { length: 100 }).notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    approvalStatus: paymentApprovalStatusEnum("approval_status").notNull().default("not_required"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    receiptUrl: text("receipt_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Automated landlord disbursements — see docs/INFRASTRUCTURE.md's payments
 * section for the EventBridge-driven flow that creates these, and the
 * regulatory flag on money passing through HomeLink's own MTN merchant
 * account (even briefly, fully automated) before landing here.
 */
export const payouts = pgTable("payouts", {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
        .notNull()
        .references(() => payments.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id")
        .notNull()
        .references(() => leases.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    providerReference: varchar("provider_reference", { length: 100 }).notNull(),
    status: payoutStatusEnum("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
    lease: one(leases, { fields: [invoices.leaseId], references: [leases.id] }),
    payments: many(payments)
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
    invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
    tenant: one(users, { fields: [payments.tenantId], references: [users.id] }),
    payouts: many(payouts)
}));

export const payoutsRelations = relations(payouts, ({ one }) => ({
    payment: one(payments, { fields: [payouts.paymentId], references: [payments.id] }),
    lease: one(leases, { fields: [payouts.leaseId], references: [leases.id] }),
    owner: one(users, { fields: [payouts.ownerId], references: [users.id] })
}));
