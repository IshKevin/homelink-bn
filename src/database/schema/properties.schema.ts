import { boolean, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users.schema";

// house/studio/condo/other are kept for existing rows (read/filter still
// work) but are no longer offered at creation — see createPropertySchema.
export const propertyTypeEnum = pgEnum("property_type", [
    "apartment",
    "house",
    "studio",
    "condo",
    "commercial",
    "other",
    "mixed_use"
]);
export const propertyStatusEnum = pgEnum("property_status", ["available", "occupied"]);
// Separate from propertyStatusEnum on purpose: a *unit* can be pulled out of
// service (maintenance) or deliberately not offered (inactive) independent
// of whether the property as a whole has any vacancy — those two states
// don't make sense for a property roll-up, only for one of its units.
export const unitStatusEnum = pgEnum("unit_status", ["available", "occupied", "maintenance", "inactive"]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const properties = pgTable("properties", {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    type: propertyTypeEnum("type").notNull(),
    documentUrl: text("document_url"),
    // Replaces the old addressLine/city/state/country/postalCode breakdown
    // with one free-text field; numberOfFloors drives floor auto-creation at
    // registration (see createProperty). The old per-property
    // category/sizeSqm/unitsCount/description/upi/terms/attributes/bedrooms/
    // bathrooms/rentAmount/rentConditions fields were dropped entirely —
    // rent/bedrooms/bathrooms now live per-unit only, floors+units replace
    // the rest.
    location: text("location").notNull(),
    numberOfFloors: integer("number_of_floors").notNull(),
    // 0 = no basement. Basement floors get negative indices in `floors`
    // (-1 = "Basement 1", the uppermost basement level, counting down).
    numberOfBasementFloors: integer("number_of_basement_floors").notNull().default(0),
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

export const floors = pgTable(
    "floors",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        propertyId: uuid("property_id")
            .notNull()
            .references(() => properties.id, { onDelete: "cascade" }),
        // Mutable display name, seeded at creation from `index` (0 -> "Ground",
        // N -> "Floor N") but editable afterward independent of index.
        name: varchar("name", { length: 100 }).notNull(),
        // Floor size/area — called "scale" by the business, kept nullable since
        // it's set via Edit after the floor exists, never at auto-creation time.
        scale: numeric("scale", { precision: 10, scale: 2 }),
        index: integer("index").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date())
    },
    (table) => [uniqueIndex("floors_property_id_index_idx").on(table.propertyId, table.index)]
);

export const propertyImages = pgTable("property_images", {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
        .notNull()
        .references(() => properties.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const propertyUnits = pgTable(
    "property_units",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        propertyId: uuid("property_id")
            .notNull()
            .references(() => properties.id, { onDelete: "cascade" }),
        // System-generated identifier (e.g. "Ground - Unit 1"), immutable
        // after creation — see generateUnits. Never editable via updateUnit;
        // `name` below is the landlord-facing field for that.
        label: varchar("label", { length: 100 }).notNull(),
        // Optional custom display name (e.g. "Shop A", "Penthouse Suite"),
        // distinct from `label` — the user can set/change this any time,
        // unlike the system-generated label.
        name: varchar("name", { length: 100 }),
        // Free-text descriptor (e.g. "2 Bedroom", "Shop", "Office") — distinct
        // from bedrooms/bathrooms, which stay numeric for filtering/search.
        unitType: varchar("unit_type", { length: 100 }),
        description: text("description"),
        floorId: uuid("floor_id")
            .notNull()
            .references(() => floors.id, { onDelete: "cascade" }),
        bedrooms: numeric("bedrooms", { precision: 4, scale: 0 }),
        bathrooms: numeric("bathrooms", { precision: 4, scale: 0 }),
        // Defaults to 0 rather than being required — bulk-generated units
        // (POST /properties/:id/units/generate) are meant to have their real
        // rent set individually afterward, not a shared guess at creation time.
        rentAmount: numeric("rent_amount", { precision: 12, scale: 2 }).notNull().default("0"),
        // Unit size/area — same "scale" concept as floors.scale, kept nullable
        // since it's optional at creation and editable afterward.
        scale: numeric("scale", { precision: 10, scale: 2 }),
        deposit: numeric("deposit", { precision: 12, scale: 2 }),
        status: unitStatusEnum("status").notNull().default("available"),
        // Soft-delete only: a unit gets archived, never hard-deleted, once it
        // could have lease/invoice/payment history hanging off it — deleting
        // the row for real would either cascade-delete that history (via
        // leases.unitId) or fail outright. Archived units are filtered out of
        // every normal read (listUnits, listAvailableUnits, property counts).
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date())
    },
    (table) => [
        // Database-level backstop against duplicate unit numbers within the
        // same property — app-level validation checks this too (for a clean
        // error message), but this is the actual guarantee. Scoped to
        // non-archived units so a label freed up by archiving can be reused.
        uniqueIndex("property_units_property_id_label_idx")
            .on(table.propertyId, table.label)
            .where(sql`${table.deletedAt} is null`)
    ]
);

export const propertiesRelations = relations(properties, ({ one, many }) => ({
    owner: one(users, { fields: [properties.ownerId], references: [users.id] }),
    agent: one(users, { fields: [properties.agentId], references: [users.id] }),
    images: many(propertyImages),
    units: many(propertyUnits),
    floors: many(floors)
}));

export const floorsRelations = relations(floors, ({ one, many }) => ({
    property: one(properties, { fields: [floors.propertyId], references: [properties.id] }),
    units: many(propertyUnits)
}));

export const propertyImagesRelations = relations(propertyImages, ({ one }) => ({
    property: one(properties, { fields: [propertyImages.propertyId], references: [properties.id] })
}));

export const propertyUnitsRelations = relations(propertyUnits, ({ one }) => ({
    property: one(properties, { fields: [propertyUnits.propertyId], references: [properties.id] }),
    floor: one(floors, { fields: [propertyUnits.floorId], references: [floors.id] })
}));
