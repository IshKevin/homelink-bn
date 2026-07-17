import { pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.schema";
import { properties } from "./properties.schema";

export const managerAssignmentStatusEnum = pgEnum("manager_assignment_status", ["active", "revoked"]);
export const inviteRoleEnum = pgEnum("invite_role", ["house_manager", "tenant"]);
export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "revoked", "expired"]);
export const suspensionRequestStatusEnum = pgEnum("suspension_request_status", ["pending", "approved", "rejected"]);

export const managerAssignments = pgTable("manager_assignments", {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    managerId: uuid("manager_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    status: managerAssignmentStatusEnum("status").notNull().default("active"),
    assignedBy: uuid("assigned_by")
        .notNull()
        .references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id)
});

export const invites = pgTable("invites", {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: inviteRoleEnum("role").notNull(),
    invitedBy: uuid("invited_by")
        .notNull()
        .references(() => users.id),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
    status: inviteStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const suspensionRequests = pgTable("suspension_requests", {
    id: uuid("id").defaultRandom().primaryKey(),
    requestedBy: uuid("requested_by")
        .notNull()
        .references(() => users.id),
    targetUserId: uuid("target_user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: suspensionRequestStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decisionNotes: text("decision_notes"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const managerAssignmentsRelations = relations(managerAssignments, ({ one }) => ({
    owner: one(users, { fields: [managerAssignments.ownerId], references: [users.id] }),
    manager: one(users, { fields: [managerAssignments.managerId], references: [users.id] }),
    assignedByUser: one(users, { fields: [managerAssignments.assignedBy], references: [users.id] })
}));

export const invitesRelations = relations(invites, ({ one }) => ({
    inviter: one(users, { fields: [invites.invitedBy], references: [users.id] }),
    owner: one(users, { fields: [invites.ownerId], references: [users.id] }),
    property: one(properties, { fields: [invites.propertyId], references: [properties.id] }),
    acceptedUser: one(users, { fields: [invites.acceptedUserId], references: [users.id] })
}));

export const suspensionRequestsRelations = relations(suspensionRequests, ({ one }) => ({
    requester: one(users, { fields: [suspensionRequests.requestedBy], references: [users.id] }),
    target: one(users, { fields: [suspensionRequests.targetUserId], references: [users.id] })
}));
