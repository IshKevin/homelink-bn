import { date, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.schema";
import { leases } from "./leases.schema";

export const invoiceStatusEnum = pgEnum("invoice_status", ["unpaid", "paid", "overdue"]);
export const paymentMethodEnum = pgEnum("payment_method", ["mobile_money", "bank_transfer"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "success", "failed"]);

export const invoices = pgTable("invoices", {
    id: uuid("id").defaultRandom().primaryKey(),
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
    failureReason: text("failure_reason"),
    receiptUrl: text("receipt_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
    lease: one(leases, { fields: [invoices.leaseId], references: [leases.id] }),
    payments: many(payments)
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
    invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
    tenant: one(users, { fields: [payments.tenantId], references: [users.id] })
}));
