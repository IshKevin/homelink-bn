import { addHours } from "date-fns";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import {
    leaseChangeRequests,
    leaseDocuments,
    leases,
    moveRequests,
    passwordResetTokens,
    properties,
    propertyUnits,
    users
} from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { generateRawToken, hashToken } from "../../common/utils/jwt.util";
import { hashPassword, generateTempPassword } from "../../common/utils/password.util";
import { getTenantSummaries, getTenantSummary } from "../../common/utils/tenantSummary.util";
import { buildObjectKey, deleteObject, getPresignedDownloadUrl, uploadBuffer } from "../../services/storage.service";
import { renderHtmlToPdf } from "../../services/pdf.service";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";
import { sendMail } from "../../services/email.service";
import { setPasswordTemplate } from "../../services/email.templates";
import { env } from "../../config/env";
import { isAdminRole, resolveEffectiveOwnerId } from "../../services/iam.service";
import { recomputePropertyStatus } from "../properties/properties.service";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type LeaseRow = typeof leases.$inferSelect;
type PropertyRow = typeof properties.$inferSelect;
type PropertyUnitRow = typeof propertyUnits.$inferSelect;
type ChangeRequestType = "renewal" | "termination";
type ChangeRequestDecision = "approved" | "rejected";
type ChecklistItem = { label: string; done: boolean };

export interface NewTenantInput {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
}

export interface CreateLeaseInput {
    propertyId: string;
    unitId: string;
    // Exactly one of these — see createLeaseSchema's refine. newTenant lets a
    // landlord/house_manager register a tenant and assign them a unit in one
    // step, instead of requiring the tenant to accept an email invite first.
    tenantId?: string;
    newTenant?: NewTenantInput;
    startDate: string;
    endDate?: string;
    paymentDate?: string;
    rentAmount: number;
    deposit?: number;
    momoNumber?: string;
    leasePeriodNote?: string;
}

async function isEffectiveLeaseOwner(lease: LeaseRow, requester: Requester): Promise<boolean> {
    if (requester.role === "owner") return lease.ownerId === requester.id;
    if (requester.role === "house_manager") return lease.ownerId === (await resolveEffectiveOwnerId(requester));
    return false;
}

export interface ListLeasesFilters {
    status?: LeaseRow["status"] | undefined;
    propertyId?: string | undefined;
}

export interface RequestChangeInput {
    proposedRent?: number | undefined;
    proposedEndDate?: string | undefined;
    reason?: string | undefined;
}

const DEFAULT_MOVE_IN_CHECKLIST: ChecklistItem[] = [
    { label: "Confirm utilities transferred", done: false },
    { label: "Collect keys and access cards", done: false },
    { label: "Record move-in meter readings", done: false },
    { label: "Receive welcome packet", done: false }
];

async function assertLeaseParty(lease: LeaseRow, requester: Requester) {
    if (isAdminRole(requester.role) || lease.tenantId === requester.id) return;
    if (await isEffectiveLeaseOwner(lease, requester)) return;
    throw AppError.forbidden("You do not have permission to access this lease");
}

async function getLeaseOrThrow(leaseId: string): Promise<LeaseRow> {
    const [lease] = await db.select().from(leases).where(eq(leases.id, leaseId)).limit(1);
    if (!lease) throw AppError.notFound("Lease not found");
    return lease;
}

async function getPropertyOrThrow(propertyId: string): Promise<PropertyRow> {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");
    return property;
}

async function getUnitOrThrow(unitId: string): Promise<PropertyUnitRow> {
    const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unitId)).limit(1);
    if (!unit) throw AppError.notFound("Unit not found");
    return unit;
}

async function assertLeaseAccess(lease: LeaseRow, requester: Requester): Promise<void> {
    if (requester.role === "agent") {
        const property = await getPropertyOrThrow(lease.propertyId);
        if (property.agentId !== requester.id) {
            throw AppError.forbidden("You do not have permission to access this lease");
        }
        return;
    }
    await assertLeaseParty(lease, requester);
}

function buildLeaseHtml(lease: LeaseRow, property: PropertyRow): string {
    return `
        <html>
            <head>
                <meta charset="utf-8" />
                <title>Lease Agreement</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 24px; }
                    h1 { font-size: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                    td { padding: 8px; border-bottom: 1px solid #ddd; }
                    td:first-child { font-weight: bold; width: 200px; }
                </style>
            </head>
            <body>
                <h1>Lease Agreement</h1>
                <table>
                    <tr><td>Lease ID</td><td>${lease.id}</td></tr>
                    <tr><td>Property</td><td>${property.title} - ${property.addressLine}, ${property.city}</td></tr>
                    <tr><td>Start Date</td><td>${lease.startDate}</td></tr>
                    <tr><td>End Date</td><td>${lease.endDate}</td></tr>
                    <tr><td>Rent Amount</td><td>${lease.rentAmount}</td></tr>
                    <tr><td>Status</td><td>${lease.status}</td></tr>
                </table>
            </body>
        </html>
    `;
}

async function generateAndStoreLeaseDocument(lease: LeaseRow, property: PropertyRow): Promise<string> {
    const html = buildLeaseHtml(lease, property);
    const buffer = await renderHtmlToPdf(html);
    const key = buildObjectKey("leases", `${lease.id}.pdf`);
    await uploadBuffer(key, buffer, "application/pdf");
    return key;
}

export async function createLease(creator: Requester, input: CreateLeaseInput) {
    if (creator.role !== "owner" && creator.role !== "house_manager" && !isAdminRole(creator.role)) {
        throw AppError.forbidden("You do not have permission to create leases");
    }

    const property = await getPropertyOrThrow(input.propertyId);

    if (creator.role === "owner" && property.ownerId !== creator.id) {
        throw AppError.forbidden("You do not have permission to create a lease for this property");
    }

    if (creator.role === "house_manager" && property.ownerId !== (await resolveEffectiveOwnerId(creator))) {
        throw AppError.forbidden("You do not have permission to create a lease for this property");
    }

    const unit = await getUnitOrThrow(input.unitId);
    if (unit.propertyId !== property.id) {
        throw AppError.badRequest("unitId does not belong to this property");
    }

    // Tenant creation + the availability check + the lease insert all happen
    // in one transaction: a partial failure otherwise could leave an
    // orphaned tenant account with no lease (if newTenant is used), or let
    // two concurrent requests both pass a since-changed availability check
    // for the same unit (this is the first db.transaction() use in this
    // codebase — the risk of a partial multi-step write is real here in a
    // way it usually isn't for this app's simpler single-insert operations).
    let rawPasswordResetToken: string | undefined;
    let temporaryPassword: string | undefined;
    const { lease, tenant } = await db.transaction(async (tx) => {
        const [freshUnit] = await tx.select().from(propertyUnits).where(eq(propertyUnits.id, unit.id)).limit(1);
        if (!freshUnit || freshUnit.status !== "available") {
            throw AppError.conflict("Unit is not available");
        }

        let tenantRow: typeof users.$inferSelect;
        if (input.newTenant) {
            const [existing] = await tx.select().from(users).where(eq(users.email, input.newTenant.email)).limit(1);
            if (existing) {
                throw AppError.conflict("An account with this email already exists");
            }

            // A landlord-created tenant often can't check email reliably, so
            // this is returned once (below, outside the transaction) for the
            // landlord to relay directly — paired with mustChangePassword so
            // the tenant is still forced to pick their own on first login.
            temporaryPassword = generateTempPassword();
            const passwordHash = await hashPassword(temporaryPassword);
            const [created] = await tx
                .insert(users)
                .values({
                    email: input.newTenant.email,
                    passwordHash,
                    firstName: input.newTenant.firstName,
                    lastName: input.newTenant.lastName,
                    phone: input.newTenant.phone,
                    role: "tenant",
                    isApproved: true,
                    mustChangePassword: true
                })
                .returning();
            if (!created) throw AppError.internal("Failed to create tenant");
            tenantRow = created;

            rawPasswordResetToken = generateRawToken();
            await tx.insert(passwordResetTokens).values({
                userId: tenantRow.id,
                tokenHash: hashToken(rawPasswordResetToken),
                expiresAt: addHours(new Date(), 24)
            });
        } else {
            const [existingTenant] = await tx.select().from(users).where(eq(users.id, input.tenantId!)).limit(1);
            if (!existingTenant || existingTenant.role !== "tenant") {
                throw AppError.badRequest("tenantId must reference an existing user with role 'tenant'");
            }
            tenantRow = existingTenant;
        }

        const [createdLease] = await tx
            .insert(leases)
            .values({
                propertyId: property.id,
                unitId: unit.id,
                tenantId: tenantRow.id,
                ownerId: property.ownerId,
                startDate: input.startDate,
                endDate: input.endDate,
                paymentDate: input.paymentDate,
                rentAmount: String(input.rentAmount),
                deposit: input.deposit !== undefined ? String(input.deposit) : undefined,
                momoNumber: input.momoNumber,
                leasePeriodNote: input.leasePeriodNote,
                status: "pending_signatures"
            })
            .returning();

        if (!createdLease) throw AppError.internal("Failed to create lease");

        // The unit becomes occupied the moment it's assigned, not when the
        // lease is later signed — otherwise two tenants could both be
        // assigned to the same unit while their leases are still pending
        // signatures (confirmed live: this was a real gap before this
        // change). Signing still moves the *lease* from pending_signatures
        // to active; it no longer needs to touch the unit's status.
        await tx.update(propertyUnits).set({ status: "occupied", updatedAt: new Date() }).where(eq(propertyUnits.id, unit.id));

        return { lease: createdLease, tenant: tenantRow };
    });

    await recomputePropertyStatus(property.id);

    await recordAction({ userId: creator.id, action: "lease.create", entity: "lease", entityId: lease.id });

    if (rawPasswordResetToken) {
        const link = `${env.appUrl}/set-password?token=${rawPasswordResetToken}`;
        await sendMail({
            to: tenant.email,
            subject: "Set your HomeLink password",
            html: setPasswordTemplate(tenant.firstName, link)
        });
    }

    await notify({
        userId: tenant.id,
        type: "lease.signature_requested",
        title: "Lease ready to sign",
        message: `A lease for "${property.title}" is ready for your signature.`,
        sendEmail: true
    });

    const tenantSummary = {
        id: tenant.id,
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        email: tenant.email,
        phone: tenant.phone
    };
    return { ...lease, tenant: tenantSummary, temporaryPassword };
}

export async function listLeases(
    requester: Requester,
    filters: ListLeasesFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];
    if (filters.status) conditions.push(eq(leases.status, filters.status));
    if (filters.propertyId) conditions.push(eq(leases.propertyId, filters.propertyId));

    let rows: (typeof leases.$inferSelect)[];
    let total: number;

    if (requester.role === "agent") {
        const where = and(eq(properties.agentId, requester.id), ...conditions);

        const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(leases)
            .innerJoin(properties, eq(leases.propertyId, properties.id))
            .where(where);

        const joined = await db
            .select({ lease: leases })
            .from(leases)
            .innerJoin(properties, eq(leases.propertyId, properties.id))
            .where(where)
            .orderBy(desc(leases.createdAt))
            .limit(pagination.limit)
            .offset(pagination.offset);

        rows = joined.map((r) => r.lease);
        total = countRow?.count ?? 0;
    } else {
        if (requester.role === "tenant") {
            conditions.push(eq(leases.tenantId, requester.id));
        } else if (requester.role === "owner") {
            conditions.push(eq(leases.ownerId, requester.id));
        } else if (requester.role === "house_manager") {
            conditions.push(eq(leases.ownerId, await resolveEffectiveOwnerId(requester)));
        }

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(leases).where(where);

        rows = await db
            .select()
            .from(leases)
            .where(where)
            .orderBy(desc(leases.createdAt))
            .limit(pagination.limit)
            .offset(pagination.offset);
        total = countRow?.count ?? 0;
    }

    const tenants = await getTenantSummaries(rows.map((r) => r.tenantId));
    return { rows: rows.map((r) => ({ ...r, tenant: tenants.get(r.tenantId) })), total };
}

export async function getLeaseById(leaseId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseAccess(lease, requester);
    return { ...lease, tenant: await getTenantSummary(lease.tenantId) };
}

export async function signLease(leaseId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);

    const isTenant = requester.id === lease.tenantId;
    const isOwner = requester.id === lease.ownerId;
    if (!isTenant && !isOwner) {
        throw AppError.forbidden("You do not have permission to sign this lease");
    }

    if (lease.status !== "pending_signatures") {
        throw AppError.conflict("Lease is not awaiting signatures");
    }

    const now = new Date();
    const signUpdates: Partial<typeof leases.$inferInsert> = { updatedAt: now };
    if (isTenant) signUpdates.tenantSignedAt = now;
    if (isOwner) signUpdates.ownerSignedAt = now;

    const [signed] = await db.update(leases).set(signUpdates).where(eq(leases.id, leaseId)).returning();
    if (!signed) throw AppError.internal("Failed to sign lease");

    await recordAction({ userId: requester.id, action: "lease.sign", entity: "lease", entityId: leaseId });

    let result = signed;

    if (signed.tenantSignedAt && signed.ownerSignedAt) {
        const property = await getPropertyOrThrow(signed.propertyId);

        await db.update(propertyUnits).set({ status: "occupied", updatedAt: now }).where(eq(propertyUnits.id, signed.unitId));
        await recomputePropertyStatus(property.id);

        await db.insert(moveRequests).values({
            leaseId: signed.id,
            type: "move_in",
            status: "pending",
            requestedBy: signed.tenantId,
            checklist: DEFAULT_MOVE_IN_CHECKLIST
        });

        const documentUrl = await generateAndStoreLeaseDocument(signed, property);

        const [activated] = await db
            .update(leases)
            .set({ status: "active", documentUrl, updatedAt: now })
            .where(eq(leases.id, leaseId))
            .returning();

        if (!activated) throw AppError.internal("Failed to activate lease");
        result = activated;

        await notify({
            userId: signed.tenantId,
            type: "lease.activated",
            title: "Lease activated",
            message: `Your lease for "${property.title}" is now active.`,
            sendEmail: true
        });
        await notify({
            userId: signed.ownerId,
            type: "lease.activated",
            title: "Lease activated",
            message: `The lease for "${property.title}" is now active.`,
            sendEmail: true
        });
    }

    return result;
}

export async function getLeaseDocument(
    leaseId: string,
    requester: Requester
): Promise<{ type: "url"; url: string } | { type: "buffer"; buffer: Buffer }> {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseAccess(lease, requester);

    if (lease.documentUrl) {
        const url = await getPresignedDownloadUrl(lease.documentUrl);
        return { type: "url", url };
    }

    const property = await getPropertyOrThrow(lease.propertyId);
    const buffer = await renderHtmlToPdf(buildLeaseHtml(lease, property));
    return { type: "buffer", buffer };
}

async function createChangeRequest(leaseId: string, requester: Requester, type: ChangeRequestType, input: RequestChangeInput) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseParty(lease, requester);

    if (lease.status !== "active") {
        throw AppError.conflict("Lease must be active to request a change");
    }

    const [changeRequest] = await db
        .insert(leaseChangeRequests)
        .values({
            leaseId: lease.id,
            type,
            requestedBy: requester.id,
            proposedRent: input.proposedRent !== undefined ? String(input.proposedRent) : undefined,
            proposedEndDate: input.proposedEndDate,
            reason: input.reason
        })
        .returning();

    if (!changeRequest) throw AppError.internal("Failed to create change request");

    const newStatus: LeaseRow["status"] = type === "renewal" ? "pending_renewal" : "pending_termination";
    await db.update(leases).set({ status: newStatus, updatedAt: new Date() }).where(eq(leases.id, leaseId));

    await recordAction({
        userId: requester.id,
        action: "lease.change_request.create",
        entity: "lease_change_request",
        entityId: changeRequest.id,
        metadata: { leaseId, type }
    });

    const otherPartyId = requester.id === lease.tenantId ? lease.ownerId : lease.tenantId;
    await notify({
        userId: otherPartyId,
        type: "lease.change_request.created",
        title: `Lease ${type} request`,
        message: `A ${type} request has been submitted for your lease.`,
        sendEmail: true
    });

    return changeRequest;
}

export async function requestRenewal(leaseId: string, requester: Requester, input: RequestChangeInput) {
    return createChangeRequest(leaseId, requester, "renewal", input);
}

export async function requestTermination(leaseId: string, requester: Requester, input: RequestChangeInput) {
    return createChangeRequest(leaseId, requester, "termination", input);
}

export async function listChangeRequests(leaseId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseAccess(lease, requester);

    return db
        .select()
        .from(leaseChangeRequests)
        .where(eq(leaseChangeRequests.leaseId, leaseId))
        .orderBy(desc(leaseChangeRequests.createdAt));
}

export async function decideChangeRequest(
    changeRequestId: string,
    decider: Requester,
    decision: ChangeRequestDecision,
    decisionNotes?: string
) {
    const [changeRequest] = await db
        .select()
        .from(leaseChangeRequests)
        .where(eq(leaseChangeRequests.id, changeRequestId))
        .limit(1);
    if (!changeRequest) throw AppError.notFound("Change request not found");

    const lease = await getLeaseOrThrow(changeRequest.leaseId);

    if (!isAdminRole(decider.role) && !(await isEffectiveLeaseOwner(lease, decider))) {
        throw AppError.forbidden("You do not have permission to decide this change request");
    }

    if (changeRequest.status !== "pending") {
        throw AppError.conflict("Change request has already been decided");
    }

    const now = new Date();

    const [updatedChangeRequest] = await db
        .update(leaseChangeRequests)
        .set({ status: decision, decidedBy: decider.id, decisionNotes, decidedAt: now })
        .where(eq(leaseChangeRequests.id, changeRequestId))
        .returning();

    if (!updatedChangeRequest) throw AppError.internal("Failed to update change request");

    if (decision === "approved") {
        if (changeRequest.type === "renewal") {
            const leaseUpdates: Partial<typeof leases.$inferInsert> = { status: "active", updatedAt: now };
            if (changeRequest.proposedEndDate) leaseUpdates.endDate = changeRequest.proposedEndDate;
            if (changeRequest.proposedRent) leaseUpdates.rentAmount = changeRequest.proposedRent;
            await db.update(leases).set(leaseUpdates).where(eq(leases.id, lease.id));
        } else {
            await db
                .update(leases)
                .set({ status: "terminated", terminatedAt: now, updatedAt: now })
                .where(eq(leases.id, lease.id));
            await db.update(propertyUnits).set({ status: "available", updatedAt: now }).where(eq(propertyUnits.id, lease.unitId));
            await recomputePropertyStatus(lease.propertyId);
        }
    } else {
        await db.update(leases).set({ status: "active", updatedAt: now }).where(eq(leases.id, lease.id));
    }

    await recordAction({
        userId: decider.id,
        action: "lease.change_request.decide",
        entity: "lease_change_request",
        entityId: changeRequestId,
        metadata: { decision }
    });

    await notify({
        userId: changeRequest.requestedBy,
        type: "lease.change_request.decided",
        title: `Lease change request ${decision}`,
        message: `Your ${changeRequest.type} request has been ${decision}.`,
        sendEmail: true
    });

    return updatedChangeRequest;
}

export async function createMoveRequest(leaseId: string, requester: Requester, type: "move_out") {
    const lease = await getLeaseOrThrow(leaseId);

    if (requester.id !== lease.tenantId) {
        throw AppError.forbidden("Only the tenant may create this move request");
    }

    if (type === "move_out" && lease.status !== "active") {
        throw AppError.conflict("Lease must be active to request a move-out");
    }

    const [moveRequest] = await db
        .insert(moveRequests)
        .values({
            leaseId: lease.id,
            type,
            status: "pending",
            requestedBy: requester.id,
            checklist: []
        })
        .returning();

    if (!moveRequest) throw AppError.internal("Failed to create move request");

    await recordAction({
        userId: requester.id,
        action: "moverequest.create",
        entity: "move_request",
        entityId: moveRequest.id,
        metadata: { leaseId, type }
    });

    await notify({
        userId: lease.ownerId,
        type: "moveout.requested",
        title: "Move-out requested",
        message: "Your tenant has requested to move out.",
        sendEmail: true
    });

    return moveRequest;
}

export async function listMoveRequests(leaseId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseAccess(lease, requester);

    return db
        .select()
        .from(moveRequests)
        .where(eq(moveRequests.leaseId, leaseId))
        .orderBy(desc(moveRequests.createdAt));
}

export async function updateMoveRequestChecklist(moveRequestId: string, requester: Requester, checklist: ChecklistItem[]) {
    const [moveRequest] = await db.select().from(moveRequests).where(eq(moveRequests.id, moveRequestId)).limit(1);
    if (!moveRequest) throw AppError.notFound("Move request not found");

    if (moveRequest.status === "completed") {
        throw AppError.conflict("Move request is already completed");
    }

    const lease = await getLeaseOrThrow(moveRequest.leaseId);
    await assertLeaseParty(lease, requester);

    const allDone = checklist.length > 0 && checklist.every((item) => item.done);
    const anyDone = checklist.some((item) => item.done);

    // Move-in has no landlord inspection step (unlike move-out), so a fully
    // checked-off checklist is what closes it out.
    const isMoveInCompletion = moveRequest.type === "move_in" && allDone;
    const newStatus: "pending" | "in_progress" | "completed" = isMoveInCompletion
        ? "completed"
        : anyDone
          ? "in_progress"
          : "pending";

    const now = new Date();
    const updates: Partial<typeof moveRequests.$inferInsert> = { checklist, status: newStatus, updatedAt: now };
    if (isMoveInCompletion) {
        updates.completedBy = requester.id;
        updates.completedAt = now;
    }

    const [updated] = await db.update(moveRequests).set(updates).where(eq(moveRequests.id, moveRequestId)).returning();

    if (!updated) throw AppError.internal("Failed to update move request checklist");

    await recordAction({
        userId: requester.id,
        action: "moverequest.checklist.update",
        entity: "move_request",
        entityId: moveRequestId
    });

    if (isMoveInCompletion) {
        await notify({
            userId: lease.ownerId,
            type: "movein.completed",
            title: "Move-in completed",
            message: "Your tenant has completed the move-in checklist.",
            sendEmail: true
        });
    }

    return updated;
}

export async function inspectMoveRequest(moveRequestId: string, inspector: Requester, inspectionNotes: string) {
    const [moveRequest] = await db.select().from(moveRequests).where(eq(moveRequests.id, moveRequestId)).limit(1);
    if (!moveRequest) throw AppError.notFound("Move request not found");

    const lease = await getLeaseOrThrow(moveRequest.leaseId);

    if (!isAdminRole(inspector.role) && !(await isEffectiveLeaseOwner(lease, inspector))) {
        throw AppError.forbidden("You do not have permission to inspect this move request");
    }

    if (moveRequest.type !== "move_out") {
        throw AppError.badRequest("Only move-out requests can be inspected");
    }

    if (moveRequest.status === "completed") {
        throw AppError.conflict("Move request is already completed");
    }

    const now = new Date();

    const [updated] = await db
        .update(moveRequests)
        .set({ status: "completed", inspectionNotes, completedBy: inspector.id, completedAt: now, updatedAt: now })
        .where(eq(moveRequests.id, moveRequestId))
        .returning();

    if (!updated) throw AppError.internal("Failed to update move request");

    if (lease.status !== "terminated") {
        await db.update(leases).set({ status: "terminated", terminatedAt: now, updatedAt: now }).where(eq(leases.id, lease.id));
        await db.update(propertyUnits).set({ status: "available", updatedAt: now }).where(eq(propertyUnits.id, lease.unitId));
        await recomputePropertyStatus(lease.propertyId);
    }

    await recordAction({
        userId: inspector.id,
        action: "moverequest.inspect",
        entity: "move_request",
        entityId: moveRequestId
    });

    await notify({
        userId: lease.tenantId,
        type: "moveout.completed",
        title: "Move-out completed",
        message: "Your move-out inspection has been completed.",
        sendEmail: true
    });

    return updated;
}

export async function addLeaseDocuments(leaseId: string, requester: Requester, files: Express.Multer.File[]) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseParty(lease, requester);

    const inserted = [];
    for (const file of files) {
        const key = buildObjectKey("lease-documents", file.originalname);
        const url = await uploadBuffer(key, file.buffer, file.mimetype);
        const [document] = await db
            .insert(leaseDocuments)
            .values({ leaseId, url, uploadedBy: requester.id })
            .returning();
        if (document) inserted.push(document);
    }

    await recordAction({ userId: requester.id, action: "lease.documents.add", entity: "lease", entityId: leaseId });

    return inserted;
}

export async function listLeaseDocuments(leaseId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseAccess(lease, requester);

    return db.select().from(leaseDocuments).where(eq(leaseDocuments.leaseId, leaseId)).orderBy(desc(leaseDocuments.createdAt));
}

export async function deleteLeaseDocument(leaseId: string, documentId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseParty(lease, requester);

    const [document] = await db
        .select()
        .from(leaseDocuments)
        .where(and(eq(leaseDocuments.id, documentId), eq(leaseDocuments.leaseId, leaseId)))
        .limit(1);
    if (!document) throw AppError.notFound("Document not found");

    await deleteObject(document.url).catch(() => undefined);
    await db.delete(leaseDocuments).where(eq(leaseDocuments.id, documentId));

    await recordAction({
        userId: requester.id,
        action: "lease.documents.delete",
        entity: "lease",
        entityId: leaseId,
        metadata: { documentId }
    });
}

export async function confirmLeaseDocuments(leaseId: string, requester: Requester) {
    const lease = await getLeaseOrThrow(leaseId);
    await assertLeaseParty(lease, requester);

    if (lease.documentsConfirmed) {
        throw AppError.conflict("Lease documents have already been confirmed");
    }

    const now = new Date();
    const [updated] = await db
        .update(leases)
        .set({ documentsConfirmed: true, documentsConfirmedBy: requester.id, documentsConfirmedAt: now, updatedAt: now })
        .where(eq(leases.id, leaseId))
        .returning();

    if (!updated) throw AppError.internal("Failed to confirm lease documents");

    await recordAction({
        userId: requester.id,
        action: "lease.documents.confirm",
        entity: "lease",
        entityId: leaseId
    });

    const otherPartyId = requester.id === lease.tenantId ? lease.ownerId : lease.tenantId;
    await notify({
        userId: otherPartyId,
        type: "lease.documents.confirmed",
        title: "Lease documents confirmed",
        message: "The lease documents have been confirmed by the other party.",
        sendEmail: true
    });

    return updated;
}
