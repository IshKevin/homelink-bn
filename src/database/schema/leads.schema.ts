import { integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const leadTypeEnum = pgEnum("lead_type", ["contact", "get_started"]);
export const leadRoleInterestEnum = pgEnum("lead_role_interest", ["owner", "house_manager", "tenant"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "converted", "dismissed"]);

export const leads = pgTable("leads", {
    id: uuid("id").defaultRandom().primaryKey(),
    type: leadTypeEnum("type").notNull(),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    roleInterest: leadRoleInterestEnum("role_interest"),
    propertyCount: integer("property_count"),
    subject: varchar("subject", { length: 255 }),
    message: text("message"),
    status: leadStatusEnum("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});
