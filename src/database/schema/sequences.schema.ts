import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const documentSequences = pgTable("document_sequences", {
    key: varchar("key", { length: 50 }).primaryKey(),
    lastValue: integer("last_value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date())
});
