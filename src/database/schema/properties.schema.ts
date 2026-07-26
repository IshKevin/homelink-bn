import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.schema";

export const propertyTypeEnum = pgEnum("property_type", [
    "apartment",
    "house",
    "studio",
    "condo",
    "commercial",
    "other"
]);
export const propertyCategoryEnum = pgEnum("property_category", ["residential", "commercial"]);
export const propertyStatusEnum = pgEnum("property_status", ["available", "occupied"]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const properties = pgTable("properties", {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    type: propertyTypeEnum("type").notNull(),
    category: propertyCategoryEnum("category").notNull().default("residential"),
    sizeSqm: numeric("size_sqm", { precision: 10, scale: 2 }),
    unitsCount: integer("units_count"),
    upi: varchar("upi", { length: 50 }),
    terms: jsonb("terms").$type<string[]>().notNull().default([]),
    attributes: jsonb("attributes").$type<{ label: string; value: string }[]>().notNull().default([]),
    documentUrl: text("document_url"),
    addressLine: varchar("address_line", { length: 255 }).notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    state: varchar("state", { length: 100 }),
    country: varchar("country", { length: 100 }).notNull(),
    postalCode: varchar("postal_code", { length: 20 }),
    bedrooms: numeric("bedrooms", { precision: 4, scale: 0 }),
    bathrooms: numeric("bathrooms", { precision: 4, scale: 0 }),
    rentAmount: numeric("rent_amount", { precision: 12, scale: 2 }).notNull(),
    rentConditions: text("rent_conditions"),
    status: propertyStatusEnum("status").notNull().default("available"),
    approvalStatus: approvalStatusEnum("approval_status").notNull().default("pending"),
    isActive: boolean("is_active").notNull().default(true),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const propertyImages = pgTable("property_images", {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
        .notNull()
        .references(() => properties.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const propertyUnits = pgTable("property_units", {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
        .notNull()
        .references(() => properties.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }).notNull(),
    bedrooms: numeric("bedrooms", { precision: 4, scale: 0 }),
    bathrooms: numeric("bathrooms", { precision: 4, scale: 0 }),
    rentAmount: numeric("rent_amount", { precision: 12, scale: 2 }).notNull(),
    status: propertyStatusEnum("status").notNull().default("available"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});

export const propertiesRelations = relations(properties, ({ one, many }) => ({
    owner: one(users, { fields: [properties.ownerId], references: [users.id] }),
    agent: one(users, { fields: [properties.agentId], references: [users.id] }),
    images: many(propertyImages),
    units: many(propertyUnits)
}));

export const propertyImagesRelations = relations(propertyImages, ({ one }) => ({
    property: one(properties, { fields: [propertyImages.propertyId], references: [properties.id] })
}));

export const propertyUnitsRelations = relations(propertyUnits, ({ one }) => ({
    property: one(properties, { fields: [propertyUnits.propertyId], references: [properties.id] })
}));
