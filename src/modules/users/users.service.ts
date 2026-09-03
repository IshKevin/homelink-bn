import { eq } from "drizzle-orm";
import { db } from "../../database";
import { identityVerifications, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { buildObjectKey, uploadBuffer } from "../../services/storage.service";
import { recordAction } from "../../services/audit.service";

function toPublicUser(user: typeof users.$inferSelect) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
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
