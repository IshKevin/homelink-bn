import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", [
    "tenant",
    "owner",
    "agent",
    "admin",
    "superadmin",
    "house_manager"
]);
export const verificationStatusEnum = pgEnum("verification_status", ["pending", "approved", "rejected"]);

export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        // Unique only among non-tenant roles (see the partial index below) —
        // tenants no longer log in by email, so the same email can be reused
        // across several separate tenant accounts (e.g. one person leasing
        // units from different landlords). Still used for notifications.
        email: varchar("email", { length: 255 }).notNull(),
        // A tenant's real login identifier — permanent until manually reset,
        // not a one-time code. Null for every other role. 8 chars,
        // uppercase alphanumeric, ambiguous characters excluded at generation
        // (see generateLoginCode in password.util.ts).
        loginCode: varchar("login_code", { length: 10 }).unique(),
        passwordHash: text("password_hash").notNull(),
        role: userRoleEnum("role").notNull().default("tenant"),
        firstName: varchar("first_name", { length: 100 }).notNull(),
        lastName: varchar("last_name", { length: 100 }).notNull(),
        phone: varchar("phone", { length: 30 }).notNull(),
        avatarUrl: text("avatar_url"),
        // Landlord's own MTN MoMo number, distinct from leases.momoNumber (the
        // tenant's number used to collect rent) — this is where automated rent
        // disbursements (see payments.schema.ts's `payouts`) get sent.
        payoutMomoNumber: varchar("payout_momo_number", { length: 30 }),
        isVerified: boolean("is_verified").notNull().default(false),
        isApproved: boolean("is_approved").notNull().default(true),
        isActive: boolean("is_active").notNull().default(true),
        // Set when a landlord/house-manager creates a tenant account directly
        // (POST /leases with newTenant) and hands them a temp password out of
        // band — forces them to pick their own on first login.
        mustChangePassword: boolean("must_change_password").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date())
    },
    (table) => [uniqueIndex("users_email_unique_non_tenant").on(table.email).where(sql`${table.role} <> 'tenant'`)]
);

export const identityVerifications = pgTable("identity_verifications", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    documentUrl: text("document_url").notNull(),
    status: verificationStatusEnum("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewNotes: text("review_notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const refreshTokens = pgTable("refresh_tokens", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    ipAddress: varchar("ip_address", { length: 100 }),
    userAgent: varchar("user_agent", { length: 255 }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const loginChallenges = pgTable("login_challenges", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    ipAddress: varchar("ip_address", { length: 100 }),
    userAgent: varchar("user_agent", { length: 255 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const usersRelations = relations(users, ({ many }) => ({
    identityVerifications: many(identityVerifications),
    refreshTokens: many(refreshTokens),
    loginChallenges: many(loginChallenges)
}));
