import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import { leases, maintenanceFeedback, maintenanceRequests, properties, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type MaintenanceRequestRow = typeof maintenanceRequests.$inferSelect;
type PropertyRow = typeof properties.$inferSelect;

export interface CreateMaintenanceRequestInput {
    propertyId: string;
    title: string;
    description: string;
}

export interface ListMaintenanceRequestsFilters {
    status?: MaintenanceRequestRow["status"] | undefined;
    propertyId?: string | undefined;
}

export interface CompleteMaintenanceRequestInput {
    itemsCost?: number | undefined;
    laborCost?: number | undefined;
    completionNotes?: string | undefined;
}

export interface SubmitFeedbackInput {
    rating: number;
    comment?: string | undefined;
}

function assertRequestAccess(request: MaintenanceRequestRow, property: PropertyRow, requester: Requester): void {
    if (
        requester.role === "admin" ||
        requester.id === request.tenantId ||
        requester.id === property.ownerId ||
        requester.id === property.agentId
    ) {
        return;
    }
    throw AppError.forbidden("You do not have permission to access this maintenance request");
}

function assertManagerAccess(property: PropertyRow, actor: Requester): void {
    if (actor.role === "admin" || actor.id === property.ownerId || actor.id === property.agentId) return;
    throw AppError.forbidden("You do not have permission to perform this action");
}

async function getPropertyOrThrow(propertyId: string): Promise<PropertyRow> {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");
    return property;
}

async function getRequestOrThrow(requestId: string): Promise<MaintenanceRequestRow> {
    const [request] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, requestId)).limit(1);
    if (!request) throw AppError.notFound("Maintenance request not found");
    return request;
}

async function getRequestWithPropertyOrThrow(
    requestId: string
): Promise<{ request: MaintenanceRequestRow; property: PropertyRow }> {
    const [row] = await db
        .select({ request: maintenanceRequests, property: properties })
        .from(maintenanceRequests)
        .innerJoin(properties, eq(maintenanceRequests.propertyId, properties.id))
        .where(eq(maintenanceRequests.id, requestId))
        .limit(1);

    if (!row) throw AppError.notFound("Maintenance request not found");
    return row;
}

export async function createMaintenanceRequest(tenant: Requester, input: CreateMaintenanceRequestInput) {
    const [activeLease] = await db
        .select()
        .from(leases)
        .where(
            and(eq(leases.propertyId, input.propertyId), eq(leases.tenantId, tenant.id), eq(leases.status, "active"))
        )
        .limit(1);

    if (!activeLease) {
        throw AppError.forbidden("You do not have an active lease on this property");
    }

    const property = await getPropertyOrThrow(input.propertyId);

    const [request] = await db
        .insert(maintenanceRequests)
        .values({
            propertyId: property.id,
            tenantId: tenant.id,
            title: input.title,
            description: input.description,
            status: "submitted"
        })
        .returning();

    if (!request) throw AppError.internal("Failed to create maintenance request");

    await recordAction({
        userId: tenant.id,
        action: "maintenance.create",
        entity: "maintenance_request",
        entityId: request.id
    });

    await notify({
        userId: property.ownerId,
        type: "maintenance.submitted",
        title: "New maintenance request",
        message: `A maintenance request "${request.title}" was submitted for "${property.title}".`,
        metadata: { requestId: request.id, propertyId: property.id },
        sendEmail: true
    });

    if (property.agentId) {
        await notify({
            userId: property.agentId,
            type: "maintenance.submitted",
            title: "New maintenance request",
            message: `A maintenance request "${request.title}" was submitted for "${property.title}".`,
            metadata: { requestId: request.id, propertyId: property.id },
            sendEmail: true
        });
    }

    return request;
}

export async function listMaintenanceRequests(
    requester: Requester,
    filters: ListMaintenanceRequestsFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];
    if (filters.status) conditions.push(eq(maintenanceRequests.status, filters.status));
    if (filters.propertyId) conditions.push(eq(maintenanceRequests.propertyId, filters.propertyId));

    if (requester.role === "tenant") {
        conditions.push(eq(maintenanceRequests.tenantId, requester.id));
    } else if (requester.role === "owner") {
        conditions.push(eq(properties.ownerId, requester.id));
    } else if (requester.role === "agent") {
        conditions.push(eq(properties.agentId, requester.id));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(maintenanceRequests)
        .innerJoin(properties, eq(maintenanceRequests.propertyId, properties.id))
        .where(where);

    const rows = await db
        .select({ request: maintenanceRequests })
        .from(maintenanceRequests)
        .innerJoin(properties, eq(maintenanceRequests.propertyId, properties.id))
        .where(where)
        .orderBy(desc(maintenanceRequests.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows: rows.map((r) => r.request), total: countRow?.count ?? 0 };
}

export async function getMaintenanceRequestById(requestId: string, requester: Requester) {
    const { request, property } = await getRequestWithPropertyOrThrow(requestId);
    assertRequestAccess(request, property, requester);
    return request;
}

export async function assignMaintenanceRequest(requestId: string, actor: Requester, assignedTo: string) {
    const { request, property } = await getRequestWithPropertyOrThrow(requestId);

    if (actor.role !== "admin" && actor.id !== property.ownerId && actor.id !== property.agentId) {
        throw AppError.forbidden("You do not have permission to assign this maintenance request");
    }

    const [assignee] = await db.select().from(users).where(eq(users.id, assignedTo)).limit(1);
    if (!assignee || (assignee.role !== "owner" && assignee.role !== "agent")) {
        throw AppError.badRequest("assignedTo must be an owner or agent user");
    }

    const [updated] = await db
        .update(maintenanceRequests)
        .set({ assignedTo, status: "assigned", updatedAt: new Date() })
        .where(eq(maintenanceRequests.id, requestId))
        .returning();

    if (!updated) throw AppError.internal("Failed to assign maintenance request");

    await recordAction({
        userId: actor.id,
        action: "maintenance.assign",
        entity: "maintenance_request",
        entityId: requestId,
        metadata: { assignedTo }
    });

    await notify({
        userId: assignedTo,
        type: "maintenance.assigned",
        title: "Maintenance request assigned",
        message: `You have been assigned to maintenance request "${request.title}" at "${property.title}".`,
        metadata: { requestId },
        sendEmail: true
    });

    return updated;
}

export async function updateMaintenanceRequestStatus(requestId: string, actor: Requester, status: "in_progress") {
    const { request, property } = await getRequestWithPropertyOrThrow(requestId);

    const isAllowed =
        actor.role === "admin" ||
        actor.id === property.ownerId ||
        actor.id === property.agentId ||
        actor.id === request.assignedTo;

    if (!isAllowed) {
        throw AppError.forbidden("You do not have permission to update this maintenance request");
    }

    if (request.status !== "assigned") {
        throw AppError.conflict("Request must be assigned before it can move to in progress");
    }

    const [updated] = await db
        .update(maintenanceRequests)
        .set({ status, updatedAt: new Date() })
        .where(eq(maintenanceRequests.id, requestId))
        .returning();

    if (!updated) throw AppError.internal("Failed to update maintenance request");

    await recordAction({
        userId: actor.id,
        action: "maintenance.status.update",
        entity: "maintenance_request",
        entityId: requestId,
        metadata: { status }
    });

    return updated;
}

export async function completeMaintenanceRequest(
    requestId: string,
    actor: Requester,
    input: CompleteMaintenanceRequestInput
) {
    const { request, property } = await getRequestWithPropertyOrThrow(requestId);

    assertManagerAccess(property, actor);

    if (request.status !== "assigned" && request.status !== "in_progress") {
        throw AppError.conflict("Request must be assigned or in progress before it can be completed");
    }

    const now = new Date();
    const updates: Partial<typeof maintenanceRequests.$inferInsert> = {
        status: "completed",
        completedAt: now,
        updatedAt: now
    };
    if (input.itemsCost !== undefined) updates.itemsCost = String(input.itemsCost);
    if (input.laborCost !== undefined) updates.laborCost = String(input.laborCost);
    if (input.completionNotes !== undefined) updates.completionNotes = input.completionNotes;

    const [updated] = await db
        .update(maintenanceRequests)
        .set(updates)
        .where(eq(maintenanceRequests.id, requestId))
        .returning();

    if (!updated) throw AppError.internal("Failed to complete maintenance request");

    await recordAction({
        userId: actor.id,
        action: "maintenance.complete",
        entity: "maintenance_request",
        entityId: requestId
    });

    await notify({
        userId: request.tenantId,
        type: "maintenance.completed",
        title: "Maintenance request completed",
        message: `Your maintenance request "${request.title}" has been completed.`,
        metadata: { requestId },
        sendEmail: true
    });

    return updated;
}

export async function submitFeedback(requestId: string, tenant: Requester, input: SubmitFeedbackInput) {
    const request = await getRequestOrThrow(requestId);

    if (request.tenantId !== tenant.id) {
        throw AppError.forbidden("You do not have permission to submit feedback for this request");
    }

    if (request.status !== "completed") {
        throw AppError.conflict("Feedback can only be submitted after the request is completed");
    }

    const [existing] = await db
        .select()
        .from(maintenanceFeedback)
        .where(eq(maintenanceFeedback.requestId, requestId))
        .limit(1);

    if (existing) {
        throw AppError.conflict("Feedback already submitted");
    }

    const [feedback] = await db
        .insert(maintenanceFeedback)
        .values({
            requestId,
            rating: input.rating,
            comment: input.comment
        })
        .returning();

    if (!feedback) throw AppError.internal("Failed to submit feedback");

    await recordAction({
        userId: tenant.id,
        action: "maintenance.feedback.submit",
        entity: "maintenance_feedback",
        entityId: feedback.id,
        metadata: { requestId }
    });

    const property = await getPropertyOrThrow(request.propertyId);

    await notify({
        userId: property.ownerId,
        type: "maintenance.feedback_submitted",
        title: "Maintenance feedback submitted",
        message: `The tenant left feedback for maintenance request "${request.title}".`,
        metadata: { requestId, rating: input.rating }
    });

    return feedback;
}

export async function getFeedback(requestId: string, requester: Requester) {
    const { request, property } = await getRequestWithPropertyOrThrow(requestId);
    assertRequestAccess(request, property, requester);

    const [feedback] = await db
        .select()
        .from(maintenanceFeedback)
        .where(eq(maintenanceFeedback.requestId, requestId))
        .limit(1);

    return feedback ?? null;
}
