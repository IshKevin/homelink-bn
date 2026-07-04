import { date, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.schema";
import { properties } from "./properties.schema";

export const leaseStatusEnum = pgEnum("lease_status", [
    "draft",
    "pending_signatures",
    "active",
    "pending_renewal",
    "pending_termination",
    "terminated",
    "expired"
]);
export const leaseChangeTypeEnum = pgEnum("lease_change_type", ["renewal", "termination"]);
export const leaseChangeStatusEnum = pgEnum("lease_change_status", ["pending", "approved", "rejected"]);
export const moveTypeEnum = pgEnum("move_type", ["move_in", "move_out"]);
export const moveStatusEnum = pgEnum("move_status", ["pending", "in_progress", "completed"]);

export const leases = pgTable("leases", {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
        .notNull()
        .references(() => properties.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    rentAmount: numeric("rent_amount", { precision: 12, scale: 2 }).notNull(),
    status: leaseStatusEnum("status").notNull().default("draft"),
    documentUrl: text("document_url"),
    tenantSignedAt: timestamp("tenant_signed_at", { withTimezone: true }),
    ownerSignedAt: timestamp("owner_signed_at", { withTimezone: true }),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const leaseChangeRequests = pgTable("lease_change_requests", {
    id: uuid("id").defaultRandom().primaryKey(),
    leaseId: uuid("lease_id")
        .notNull()
        .references(() => leases.id, { onDelete: "cascade" }),
    type: leaseChangeTypeEnum("type").notNull(),
    requestedBy: uuid("requested_by")
        .notNull()
        .references(() => users.id),
    proposedRent: numeric("proposed_rent", { precision: 12, scale: 2 }),
    proposedEndDate: date("proposed_end_date"),
    reason: text("reason"),
    status: leaseChangeStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decisionNotes: text("decision_notes"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const moveRequests = pgTable("move_requests", {
    id: uuid("id").defaultRandom().primaryKey(),
    leaseId: uuid("lease_id")
        .notNull()
        .references(() => leases.id, { onDelete: "cascade" }),
    type: moveTypeEnum("type").notNull(),
    status: moveStatusEnum("status").notNull().default("pending"),
    checklist: jsonb("checklist").$type<{ label: string; done: boolean }[]>().default([]),
    inspectionNotes: text("inspection_notes"),
    requestedBy: uuid("requested_by")
        .notNull()
        .references(() => users.id),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const leasesRelations = relations(leases, ({ one, many }) => ({
    property: one(properties, { fields: [leases.propertyId], references: [properties.id] }),
    tenant: one(users, { fields: [leases.tenantId], references: [users.id] }),
    owner: one(users, { fields: [leases.ownerId], references: [users.id] }),
    changeRequests: many(leaseChangeRequests),
    moveRequests: many(moveRequests)
}));
