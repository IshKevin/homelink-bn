import { integer, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.schema";
import { properties } from "./properties.schema";

export const maintenanceStatusEnum = pgEnum("maintenance_status", [
    "submitted",
    "assigned",
    "in_progress",
    "completed"
]);
export const maintenancePriorityEnum = pgEnum("maintenance_priority", ["low", "medium", "high"]);

export const maintenanceRequests = pgTable("maintenance_requests", {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
        .notNull()
        .references(() => properties.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
        .notNull()
        .references(() => users.id),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    priority: maintenancePriorityEnum("priority").notNull().default("medium"),
    status: maintenanceStatusEnum("status").notNull().default("submitted"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    itemsCost: numeric("items_cost", { precision: 12, scale: 2 }),
    laborCost: numeric("labor_cost", { precision: 12, scale: 2 }),
    completionNotes: text("completion_notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const maintenanceFeedback = pgTable("maintenance_feedback", {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
        .notNull()
        .references(() => maintenanceRequests.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const maintenanceRequestsRelations = relations(maintenanceRequests, ({ one, many }) => ({
    property: one(properties, { fields: [maintenanceRequests.propertyId], references: [properties.id] }),
    tenant: one(users, { fields: [maintenanceRequests.tenantId], references: [users.id] }),
    assignee: one(users, { fields: [maintenanceRequests.assignedTo], references: [users.id] }),
    feedback: many(maintenanceFeedback)
}));

export const maintenanceFeedbackRelations = relations(maintenanceFeedback, ({ one }) => ({
    request: one(maintenanceRequests, { fields: [maintenanceFeedback.requestId], references: [maintenanceRequests.id] })
}));
