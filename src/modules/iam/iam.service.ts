import { addDays } from "date-fns";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database";
import { invites, managerAssignments, suspensionRequests, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { generateRawToken, hashToken } from "../../common/utils/jwt.util";
import { hashPassword } from "../../common/utils/password.util";
import { recordAction } from "../../services/audit.service";
import { sendMail } from "../../services/email.service";
import { inviteTemplate } from "../../services/email.templates";
import { env } from "../../config/env";
import { resolveEffectiveOwnerId } from "../../services/iam.service";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type InviteRow = typeof invites.$inferSelect;
type ManagerAssignmentRow = typeof managerAssignments.$inferSelect;

function toPublicUser(user: typeof users.$inferSelect) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
}

async function createInvite(
    inviter: Requester,
    ownerId: string,
    email: string,
    role: InviteRow["role"],
    propertyId?: string
) {
    const [inviterUser] = await db.select().from(users).where(eq(users.id, inviter.id)).limit(1);
    if (!inviterUser) throw AppError.notFound("Inviter not found");

    const rawToken = generateRawToken();
    const [invite] = await db
        .insert(invites)
        .values({
            tokenHash: hashToken(rawToken),
            email,
            role,
            invitedBy: inviter.id,
            ownerId,
            propertyId,
            expiresAt: addDays(new Date(), 7)
        })
        .returning();

    if (!invite) throw AppError.internal("Failed to create invite");

    const link = `${env.appUrl}/join?token=${rawToken}`;
    const roleLabel = role === "house_manager" ? "house manager" : "tenant";
    await sendMail({
        to: email,
        subject: "You've been invited to HomeLink",
        html: inviteTemplate(`${inviterUser.firstName} ${inviterUser.lastName}`, roleLabel, link)
    });

    await recordAction({
        userId: inviter.id,
        action: "iam.invite.create",
        entity: "invite",
        entityId: invite.id,
        metadata: { role, email }
    });

    return invite;
}

export async function inviteManager(inviter: Requester, email: string) {
    if (inviter.role !== "owner") {
        throw AppError.forbidden("Only a house owner can invite a house manager");
    }
    return createInvite(inviter, inviter.id, email, "house_manager");
}

export async function inviteTenant(inviter: Requester, email: string, propertyId?: string) {
    if (inviter.role !== "owner" && inviter.role !== "house_manager") {
        throw AppError.forbidden("Only a house owner or house manager can invite a tenant");
    }
    const ownerId = await resolveEffectiveOwnerId(inviter);
    return createInvite(inviter, ownerId, email, "tenant", propertyId);
}

export async function listInvites(requester: Requester, pagination: { limit: number; offset: number }) {
    const ownerId = await resolveEffectiveOwnerId(requester);

    const rows = await db
        .select()
        .from(invites)
        .where(eq(invites.ownerId, ownerId))
        .orderBy(desc(invites.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return rows;
}

export async function listManagers(requester: Requester) {
    const ownerId = await resolveEffectiveOwnerId(requester);

    return db
        .select()
        .from(managerAssignments)
        .where(eq(managerAssignments.ownerId, ownerId))
        .orderBy(desc(managerAssignments.assignedAt));
}

async function getManagerAssignmentOrThrow(assignmentId: string): Promise<ManagerAssignmentRow> {
    const [assignment] = await db
        .select()
        .from(managerAssignments)
        .where(eq(managerAssignments.id, assignmentId))
        .limit(1);
    if (!assignment) throw AppError.notFound("Manager assignment not found");
    return assignment;
}

export async function revokeManager(assignmentId: string, requester: Requester) {
    const assignment = await getManagerAssignmentOrThrow(assignmentId);

    if (requester.role !== "owner" || assignment.ownerId !== requester.id) {
        throw AppError.forbidden("You do not have permission to revoke this manager");
    }

    if (assignment.status !== "active") {
        throw AppError.conflict("Manager assignment is already revoked");
    }

    const [updated] = await db
        .update(managerAssignments)
        .set({ status: "revoked", revokedAt: new Date(), revokedBy: requester.id })
        .where(eq(managerAssignments.id, assignmentId))
        .returning();

    if (!updated) throw AppError.internal("Failed to revoke manager");

    await recordAction({
        userId: requester.id,
        action: "iam.manager.revoke",
        entity: "manager_assignment",
        entityId: assignmentId
    });

    return updated;
}

export interface AcceptInviteInput {
    token: string;
    firstName: string;
    lastName: string;
    phone: string;
    password: string;
}

export async function acceptInvite(input: AcceptInviteInput) {
    const tokenHash = hashToken(input.token);
    const [invite] = await db
        .select()
        .from(invites)
        .where(and(eq(invites.tokenHash, tokenHash), eq(invites.status, "pending")))
        .limit(1);

    if (!invite || invite.expiresAt < new Date()) {
        throw AppError.badRequest("Invalid or expired invite");
    }

    const [existing] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
    if (existing) {
        throw AppError.conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(input.password);
    const [user] = await db
        .insert(users)
        .values({
            email: invite.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            role: invite.role,
            isApproved: true
        })
        .returning();

    if (!user) throw AppError.internal("Failed to create account");

    if (invite.role === "house_manager") {
        await db.insert(managerAssignments).values({
            ownerId: invite.ownerId,
            managerId: user.id,
            assignedBy: invite.invitedBy,
            status: "active"
        });
    }

    const now = new Date();
    await db
        .update(invites)
        .set({ status: "accepted", acceptedAt: now, acceptedUserId: user.id })
        .where(eq(invites.id, invite.id));

    await recordAction({
        userId: user.id,
        action: "iam.invite.accept",
        entity: "invite",
        entityId: invite.id
    });

    return toPublicUser(user);
}

export async function createSuspensionRequest(requester: Requester, targetUserId: string, reason: string) {
    if (requester.role !== "owner" && requester.role !== "house_manager") {
        throw AppError.forbidden("Only a house owner or house manager can request a suspension");
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) throw AppError.notFound("User not found");

    const [request] = await db
        .insert(suspensionRequests)
        .values({ requestedBy: requester.id, targetUserId, reason })
        .returning();

    if (!request) throw AppError.internal("Failed to create suspension request");

    await recordAction({
        userId: requester.id,
        action: "iam.suspension_request.create",
        entity: "suspension_request",
        entityId: request.id,
        metadata: { targetUserId }
    });

    return request;
}
