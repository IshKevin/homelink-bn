import { addHours } from "date-fns";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../../database";
import {
    auditLogs,
    identityVerifications,
    passwordResetTokens,
    platformSettings,
    properties,
    suspensionRequests,
    users
} from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { generateRawToken, hashToken } from "../../common/utils/jwt.util";
import { hashPassword } from "../../common/utils/password.util";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";
import { sendMail } from "../../services/email.service";
import { setPasswordTemplate } from "../../services/email.templates";
import { env } from "../../config/env";
import { releaseHeldPayouts } from "../payments/payouts.service";

type UserRow = typeof users.$inferSelect;
type IdentityVerificationRow = typeof identityVerifications.$inferSelect;
type SuspensionRequestRow = typeof suspensionRequests.$inferSelect;

function toPublicUser(user: UserRow) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
}

export interface ListUsersFilters {
    role?: UserRow["role"] | undefined;
    isApproved?: "true" | "false" | undefined;
    isActive?: "true" | "false" | undefined;
    search?: string | undefined;
}

export async function listUsers(filters: ListUsersFilters, pagination: { limit: number; offset: number }) {
    const conditions = [];
    if (filters.role) conditions.push(eq(users.role, filters.role));
    if (filters.isApproved !== undefined) conditions.push(eq(users.isApproved, filters.isApproved === "true"));
    if (filters.isActive !== undefined) conditions.push(eq(users.isActive, filters.isActive === "true"));
    if (filters.search) {
        const term = `%${filters.search}%`;
        conditions.push(
            or(ilike(users.email, term), ilike(users.firstName, term), ilike(users.lastName, term))
        );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: count() }).from(users).where(where);

    const rows = await db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows: rows.map(toPublicUser), total: countRow?.count ?? 0 };
}

async function getUserOrThrow(userId: string): Promise<UserRow> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.notFound("User not found");
    return user;
}

export async function getUserById(userId: string) {
    const user = await getUserOrThrow(userId);
    return toPublicUser(user);
}

export async function updateUserStatus(adminId: string, userId: string, isActive: boolean) {
    await getUserOrThrow(userId);

    const [updated] = await db.update(users).set({ isActive }).where(eq(users.id, userId)).returning();
    if (!updated) throw AppError.internal("Failed to update user status");

    await recordAction({
        userId: adminId,
        action: "admin.user.status_update",
        entity: "user",
        entityId: userId,
        metadata: { isActive }
    });

    await notify({
        userId,
        type: isActive ? "account.reactivated" : "account.deactivated",
        title: isActive ? "Account reactivated" : "Account deactivated",
        message: isActive
            ? "Your account has been reactivated by an administrator."
            : "Your account has been deactivated by an administrator.",
        metadata: { isActive },
        sendEmail: true
    });

    if (isActive && updated.role === "owner") {
        await releaseHeldPayouts(userId);
    }

    return toPublicUser(updated);
}

export async function approveAgent(adminId: string, userId: string) {
    const user = await getUserOrThrow(userId);

    if (user.role !== "agent") {
        throw AppError.badRequest("User is not an agent");
    }

    if (user.isApproved !== false) {
        throw AppError.conflict("Agent is already approved");
    }

    const [updated] = await db.update(users).set({ isApproved: true }).where(eq(users.id, userId)).returning();
    if (!updated) throw AppError.internal("Failed to approve agent");

    await recordAction({
        userId: adminId,
        action: "admin.agent.approve",
        entity: "user",
        entityId: userId
    });

    await notify({
        userId,
        type: "agent.approved",
        title: "Agent account approved",
        message: "Your agent account has been approved. You can now start managing properties.",
        sendEmail: true
    });

    return toPublicUser(updated);
}

export interface ListIdentityVerificationsFilters {
    status?: IdentityVerificationRow["status"] | undefined;
}

export async function listIdentityVerifications(
    filters: ListIdentityVerificationsFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];
    if (filters.status) conditions.push(eq(identityVerifications.status, filters.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: count() }).from(identityVerifications).where(where);

    const rows = await db
        .select()
        .from(identityVerifications)
        .where(where)
        .orderBy(desc(identityVerifications.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

async function getVerificationOrThrow(verificationId: string): Promise<IdentityVerificationRow> {
    const [verification] = await db
        .select()
        .from(identityVerifications)
        .where(eq(identityVerifications.id, verificationId))
        .limit(1);
    if (!verification) throw AppError.notFound("Identity verification not found");
    return verification;
}

export async function approveIdentityVerification(adminId: string, verificationId: string) {
    const verification = await getVerificationOrThrow(verificationId);

    if (verification.status !== "pending") {
        throw AppError.conflict("Identity verification has already been reviewed");
    }

    const now = new Date();
    const [updated] = await db
        .update(identityVerifications)
        .set({ status: "approved", reviewedBy: adminId, reviewedAt: now })
        .where(eq(identityVerifications.id, verificationId))
        .returning();

    if (!updated) throw AppError.internal("Failed to approve identity verification");

    await db.update(users).set({ isVerified: true }).where(eq(users.id, verification.userId));

    await recordAction({
        userId: adminId,
        action: "admin.identity_verification.approve",
        entity: "identity_verification",
        entityId: verificationId
    });

    await notify({
        userId: verification.userId,
        type: "identity_verification.approved",
        title: "Identity verification approved",
        message: "Your identity verification has been approved.",
        sendEmail: true
    });

    return updated;
}

export async function rejectIdentityVerification(adminId: string, verificationId: string, reviewNotes: string) {
    const verification = await getVerificationOrThrow(verificationId);

    if (verification.status !== "pending") {
        throw AppError.conflict("Identity verification has already been reviewed");
    }

    const now = new Date();
    const [updated] = await db
        .update(identityVerifications)
        .set({ status: "rejected", reviewedBy: adminId, reviewedAt: now, reviewNotes })
        .where(eq(identityVerifications.id, verificationId))
        .returning();

    if (!updated) throw AppError.internal("Failed to reject identity verification");

    await recordAction({
        userId: adminId,
        action: "admin.identity_verification.reject",
        entity: "identity_verification",
        entityId: verificationId,
        metadata: { reviewNotes }
    });

    await notify({
        userId: verification.userId,
        type: "identity_verification.rejected",
        title: "Identity verification rejected",
        message: reviewNotes,
        metadata: { reviewNotes },
        sendEmail: true
    });

    return updated;
}

async function getPropertyOrThrow(propertyId: string) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");
    return property;
}

export async function deactivateProperty(adminId: string, propertyId: string, reason: string) {
    const property = await getPropertyOrThrow(propertyId);

    if (!property.isActive) {
        throw AppError.conflict("Property is already deactivated");
    }

    const [updated] = await db
        .update(properties)
        .set({ isActive: false })
        .where(eq(properties.id, propertyId))
        .returning();

    if (!updated) throw AppError.internal("Failed to deactivate property");

    await recordAction({
        userId: adminId,
        action: "admin.property.deactivate",
        entity: "property",
        entityId: propertyId,
        metadata: { reason }
    });

    await notify({
        userId: property.ownerId,
        type: "property.deactivated",
        title: "Property listing deactivated",
        message: reason,
        metadata: { propertyId, reason },
        sendEmail: true
    });

    return updated;
}

export async function reactivateProperty(adminId: string, propertyId: string) {
    const property = await getPropertyOrThrow(propertyId);

    if (property.isActive) {
        throw AppError.conflict("Property is already active");
    }

    const [updated] = await db
        .update(properties)
        .set({ isActive: true })
        .where(eq(properties.id, propertyId))
        .returning();

    if (!updated) throw AppError.internal("Failed to reactivate property");

    await recordAction({
        userId: adminId,
        action: "admin.property.reactivate",
        entity: "property",
        entityId: propertyId
    });

    await notify({
        userId: property.ownerId,
        type: "property.reactivated",
        title: "Property listing reactivated",
        message: "Your property listing has been reactivated by an administrator.",
        metadata: { propertyId },
        sendEmail: true
    });

    return updated;
}

export async function getSettings() {
    return db.select().from(platformSettings);
}

export async function upsertSetting(adminId: string, key: string, value: unknown) {
    const [setting] = await db
        .insert(platformSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } })
        .returning();

    if (!setting) throw AppError.internal("Failed to upsert platform setting");

    await recordAction({
        userId: adminId,
        action: "admin.setting.upsert",
        entity: "platform_setting",
        entityId: key,
        metadata: { value }
    });

    return setting;
}

export interface ListAuditLogsFilters {
    userId?: string | undefined;
    entity?: string | undefined;
    action?: string | undefined;
}

export async function listAuditLogs(filters: ListAuditLogsFilters, pagination: { limit: number; offset: number }) {
    const conditions = [];
    if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
    if (filters.entity) conditions.push(eq(auditLogs.entity, filters.entity));
    if (filters.action) conditions.push(eq(auditLogs.action, filters.action));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: count() }).from(auditLogs).where(where);

    const rows = await db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

export interface CreateHouseOwnerInput {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
}

export async function createHouseOwner(adminId: string, input: CreateHouseOwnerInput) {
    const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) {
        throw AppError.conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(generateRawToken());
    const [owner] = await db
        .insert(users)
        .values({
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            role: "owner",
            isApproved: true
        })
        .returning();

    if (!owner) throw AppError.internal("Failed to create house owner");

    const rawToken = generateRawToken();
    await db.insert(passwordResetTokens).values({
        userId: owner.id,
        tokenHash: hashToken(rawToken),
        expiresAt: addHours(new Date(), 24)
    });

    const link = `${env.appUrl}/set-password?token=${rawToken}`;
    await sendMail({
        to: owner.email,
        subject: "Set your HomeLink password",
        html: setPasswordTemplate(owner.firstName, link)
    });

    await recordAction({
        userId: adminId,
        action: "admin.house_owner.create",
        entity: "user",
        entityId: owner.id
    });

    return toPublicUser(owner);
}

export interface ListSuspensionRequestsFilters {
    status?: SuspensionRequestRow["status"] | undefined;
}

export async function listSuspensionRequests(
    filters: ListSuspensionRequestsFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];
    if (filters.status) conditions.push(eq(suspensionRequests.status, filters.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: count() }).from(suspensionRequests).where(where);

    const rows = await db
        .select()
        .from(suspensionRequests)
        .where(where)
        .orderBy(desc(suspensionRequests.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

async function getSuspensionRequestOrThrow(requestId: string): Promise<SuspensionRequestRow> {
    const [request] = await db
        .select()
        .from(suspensionRequests)
        .where(eq(suspensionRequests.id, requestId))
        .limit(1);
    if (!request) throw AppError.notFound("Suspension request not found");
    return request;
}

async function decideSuspensionRequest(
    adminId: string,
    requestId: string,
    decision: "approved" | "rejected",
    decisionNotes: string | undefined
) {
    const request = await getSuspensionRequestOrThrow(requestId);

    if (request.status !== "pending") {
        throw AppError.conflict("Suspension request has already been decided");
    }

    const now = new Date();
    const [updated] = await db
        .update(suspensionRequests)
        .set({ status: decision, decidedBy: adminId, decisionNotes, decidedAt: now })
        .where(eq(suspensionRequests.id, requestId))
        .returning();

    if (!updated) throw AppError.internal("Failed to decide suspension request");

    if (decision === "approved") {
        await db.update(users).set({ isActive: false }).where(eq(users.id, request.targetUserId));
        await notify({
            userId: request.targetUserId,
            type: "account.suspended",
            title: "Account suspended",
            message: "Your account has been suspended by an administrator.",
            sendEmail: true
        });
    }

    await recordAction({
        userId: adminId,
        action: `admin.suspension_request.${decision}`,
        entity: "suspension_request",
        entityId: requestId,
        metadata: { decisionNotes }
    });

    await notify({
        userId: request.requestedBy,
        type: `suspension_request.${decision}`,
        title: `Suspension request ${decision}`,
        message: decisionNotes ?? `Your suspension request has been ${decision}.`,
        sendEmail: true
    });

    return updated;
}

export async function approveSuspensionRequest(adminId: string, requestId: string, decisionNotes?: string) {
    return decideSuspensionRequest(adminId, requestId, "approved", decisionNotes);
}

export async function rejectSuspensionRequest(adminId: string, requestId: string, decisionNotes?: string) {
    return decideSuspensionRequest(adminId, requestId, "rejected", decisionNotes);
}
