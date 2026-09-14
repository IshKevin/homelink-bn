import { and, count, eq, ilike, or } from "drizzle-orm";
import { db } from "../../database";
import { identityVerifications, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { buildObjectKey, uploadBuffer } from "../../services/storage.service";
import { recordAction } from "../../services/audit.service";

type UserRow = typeof users.$inferSelect;

function toPublicUser(user: UserRow) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
}

export interface SearchUsersFilters {
    role?: UserRow["role"] | undefined;
    search?: string | undefined;
}

/**
 * Directory lookup for landlords/agents/managers/admins to check whether a
 * person already has an account (by name/email/phone) before creating a
 * duplicate one — e.g. when assigning a tenant to a unit. Deliberately a
 * narrower projection than admin.service.ts's listUsers: no isApproved,
 * mustChangePassword, payoutMomoNumber, etc. — just enough to identify
 * someone and grab their id.
 */
export async function searchUsers(filters: SearchUsersFilters, pagination: { limit: number; offset: number }) {
    const conditions = [];
    if (filters.role) conditions.push(eq(users.role, filters.role));
    if (filters.search) {
        const term = `%${filters.search}%`;
        conditions.push(
            or(ilike(users.firstName, term), ilike(users.lastName, term), ilike(users.email, term), ilike(users.phone, term))
        );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: count() }).from(users).where(where);

    const rows = await db
        .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            role: users.role,
            isActive: users.isActive
        })
        .from(users)
        .where(where)
        .orderBy(users.firstName, users.lastName)
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

export async function getById(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.notFound("User not found");
    return toPublicUser(user);
}

export interface UpdateProfileInput {
    firstName?: string;
    lastName?: string;
    phone?: string;
    avatarUrl?: string;
    payoutMomoNumber?: string;
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
    const [updated] = await db.update(users).set(input).where(eq(users.id, userId)).returning();
    if (!updated) throw AppError.notFound("User not found");
    return toPublicUser(updated);
}

export async function submitIdentityVerification(userId: string, file: Express.Multer.File) {
    const key = buildObjectKey(`identity/${userId}`, file.originalname);
    await uploadBuffer(key, file.buffer, file.mimetype);

    const [verification] = await db
        .insert(identityVerifications)
        .values({ userId, documentUrl: key })
        .returning();

    if (!verification) throw AppError.internal("Failed to create identity verification");

    await recordAction({ userId, action: "user.verification.submit", entity: "identity_verification", entityId: verification.id });

    return verification;
}

export async function getMyVerifications(userId: string) {
    return db.select().from(identityVerifications).where(eq(identityVerifications.userId, userId));
}
