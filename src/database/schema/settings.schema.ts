import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const platformSettings = pgTable("platform_settings", {
    key: varchar("key", { length: 100 }).primaryKey(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});
