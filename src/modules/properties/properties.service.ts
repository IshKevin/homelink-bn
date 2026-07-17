import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db } from "../../database";
import { properties, propertyImages, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { buildObjectKey, deleteObject, uploadBuffer } from "../../services/storage.service";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";
import { isAdminRole, resolveEffectiveOwnerId } from "../../services/iam.service";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type PropertyRow = typeof properties.$inferSelect;

export interface CreatePropertyInput {
    title: string;
    description?: string;
    type: PropertyRow["type"];
    category: PropertyRow["category"];
    sizeSqm?: number;
    unitsCount?: number;
    addressLine: string;
    city: string;
    state?: string;
    country: string;
    postalCode?: string;
    bedrooms?: number;
    bathrooms?: number;
    rentAmount: number;
    rentConditions?: string;
    ownerId?: string;
}

export interface UpdatePropertyInput {
    title?: string;
    description?: string;
    type?: PropertyRow["type"];
    category?: PropertyRow["category"];
    sizeSqm?: number;
    unitsCount?: number;
    addressLine?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    bedrooms?: number;
    bathrooms?: number;
    rentAmount?: number;
    rentConditions?: string;
    status?: PropertyRow["status"];
}

export interface ListPropertiesFilters {
    status?: PropertyRow["status"] | undefined;
    type?: PropertyRow["type"] | undefined;
    category?: PropertyRow["category"] | undefined;
    city?: string | undefined;
    minRent?: number | undefined;
    maxRent?: number | undefined;
    ownerId?: string | undefined;
}

async function assertPropertyWriteAccess(property: PropertyRow, requester: Requester) {
    if (isAdminRole(requester.role)) return;

    const isOwner = requester.role === "owner" && property.ownerId === requester.id;
    const isAgent = requester.role === "agent" && property.agentId === requester.id;
    const isManager =
        requester.role === "house_manager" && property.ownerId === (await resolveEffectiveOwnerId(requester));
    if (isOwner || isAgent || isManager) return;
    throw AppError.forbidden("You do not have permission to modify this property");
}

export async function createProperty(creator: Requester, input: CreatePropertyInput) {
    let ownerId: string;
    let agentId: string | undefined;

    if (creator.role === "owner") {
        if (input.ownerId && input.ownerId !== creator.id) {
            throw AppError.badRequest("Owners cannot create properties on behalf of another owner");
        }
        ownerId = creator.id;
    } else if (creator.role === "house_manager") {
        ownerId = await resolveEffectiveOwnerId(creator);
    } else if (creator.role === "agent" || isAdminRole(creator.role)) {
        if (creator.role === "agent") {
            const [agent] = await db.select().from(users).where(eq(users.id, creator.id)).limit(1);
            if (!agent || !agent.isApproved) {
                throw AppError.forbidden("Your agent account must be approved by an administrator before you can list properties");
            }
        }

        if (!input.ownerId) {
            throw AppError.badRequest("ownerId is required when creating a property on behalf of an owner");
        }
        const [owner] = await db.select().from(users).where(eq(users.id, input.ownerId)).limit(1);
        if (!owner || owner.role !== "owner") {
            throw AppError.badRequest("ownerId must reference an existing user with role 'owner'");
        }
        ownerId = owner.id;
        if (creator.role === "agent") {
            agentId = creator.id;
        }
    } else {
        throw AppError.forbidden("You do not have permission to create properties");
    }

    const [property] = await db
        .insert(properties)
        .values({
            ownerId,
            agentId,
            title: input.title,
            description: input.description,
            type: input.type,
            category: input.category,
            sizeSqm: input.sizeSqm !== undefined ? String(input.sizeSqm) : undefined,
            unitsCount: input.unitsCount,
            addressLine: input.addressLine,
            city: input.city,
            state: input.state,
            country: input.country,
            postalCode: input.postalCode,
            bedrooms: input.bedrooms !== undefined ? String(input.bedrooms) : undefined,
            bathrooms: input.bathrooms !== undefined ? String(input.bathrooms) : undefined,
            rentAmount: String(input.rentAmount),
            rentConditions: input.rentConditions,
            status: "available",
            approvalStatus: "pending"
        })
        .returning();

    if (!property) throw AppError.internal("Failed to create property");

    await recordAction({ userId: creator.id, action: "property.create", entity: "property", entityId: property.id });

    return property;
}

export async function updateProperty(propertyId: string, requester: Requester, input: UpdatePropertyInput) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);

    const { bedrooms, bathrooms, rentAmount, sizeSqm, ...rest } = input;
    const updates: Partial<typeof properties.$inferInsert> = { ...rest };
    if (bedrooms !== undefined) updates.bedrooms = String(bedrooms);
    if (bathrooms !== undefined) updates.bathrooms = String(bathrooms);
    if (rentAmount !== undefined) updates.rentAmount = String(rentAmount);
    if (sizeSqm !== undefined) updates.sizeSqm = String(sizeSqm);
    updates.updatedAt = new Date();

    const [updated] = await db.update(properties).set(updates).where(eq(properties.id, propertyId)).returning();
    if (!updated) throw AppError.notFound("Property not found");

    await recordAction({ userId: requester.id, action: "property.update", entity: "property", entityId: propertyId });

    return updated;
}

export async function listProperties(
    requester: Requester,
    filters: ListPropertiesFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];

    if (filters.status) conditions.push(eq(properties.status, filters.status));
    if (filters.type) conditions.push(eq(properties.type, filters.type));
    if (filters.category) conditions.push(eq(properties.category, filters.category));
    if (filters.city) conditions.push(ilike(properties.city, `%${filters.city}%`));
    if (filters.minRent !== undefined) conditions.push(gte(properties.rentAmount, String(filters.minRent)));
    if (filters.maxRent !== undefined) conditions.push(lte(properties.rentAmount, String(filters.maxRent)));
    if (filters.ownerId) conditions.push(eq(properties.ownerId, filters.ownerId));

    if (requester.role === "owner") {
        conditions.push(eq(properties.ownerId, requester.id));
    } else if (requester.role === "house_manager") {
        conditions.push(eq(properties.ownerId, await resolveEffectiveOwnerId(requester)));
    } else if (requester.role === "agent") {
        conditions.push(eq(properties.agentId, requester.id));
    } else if (requester.role === "tenant") {
        conditions.push(eq(properties.approvalStatus, "approved"));
        conditions.push(eq(properties.isActive, true));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(properties).where(where);

    const rows = await db
        .select()
        .from(properties)
        .where(where)
        .orderBy(desc(properties.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

export async function getPropertyById(propertyId: string, requester: Requester) {
    const property = await db.query.properties.findFirst({
        where: eq(properties.id, propertyId),
        with: { images: true }
    });

    if (!property) throw AppError.notFound("Property not found");

    if (requester.role === "tenant" && !(property.approvalStatus === "approved" && property.isActive)) {
        throw AppError.notFound("Property not found");
    }

    return property;
}

export async function addPropertyImages(propertyId: string, requester: Requester, files: Express.Multer.File[]) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);

    const inserted = [];
    for (const file of files) {
        const key = buildObjectKey("properties", file.originalname);
        const url = await uploadBuffer(key, file.buffer, file.mimetype);
        const [image] = await db.insert(propertyImages).values({ propertyId, url }).returning();
        if (image) inserted.push(image);
    }

    await recordAction({ userId: requester.id, action: "property.images.add", entity: "property", entityId: propertyId });

    return inserted;
}

export async function deletePropertyImage(propertyId: string, imageId: string, requester: Requester) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);

    const [image] = await db
        .select()
        .from(propertyImages)
        .where(and(eq(propertyImages.id, imageId), eq(propertyImages.propertyId, propertyId)))
        .limit(1);

    if (!image) throw AppError.notFound("Image not found");

    await deleteObject(image.url).catch(() => undefined);
    await db.delete(propertyImages).where(eq(propertyImages.id, imageId));

    await recordAction({
        userId: requester.id,
        action: "property.images.delete",
        entity: "property",
        entityId: propertyId,
        metadata: { imageId }
    });
}

export async function approveProperty(propertyId: string, admin: Requester) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    const [updated] = await db
        .update(properties)
        .set({ approvalStatus: "approved", approvedBy: admin.id, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(properties.id, propertyId))
        .returning();

    if (!updated) throw AppError.notFound("Property not found");

    await recordAction({ userId: admin.id, action: "property.approve", entity: "property", entityId: propertyId });

    await notify({
        userId: property.ownerId,
        type: "property.approved",
        title: "Property approved",
        message: `Your property "${property.title}" has been approved and is now listed.`,
        sendEmail: true
    });

    return updated;
}

export async function rejectProperty(propertyId: string, admin: Requester, rejectionReason: string) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    const [updated] = await db
        .update(properties)
        .set({ approvalStatus: "rejected", rejectionReason, updatedAt: new Date() })
        .where(eq(properties.id, propertyId))
        .returning();

    if (!updated) throw AppError.notFound("Property not found");

    await recordAction({ userId: admin.id, action: "property.reject", entity: "property", entityId: propertyId });

    await notify({
        userId: property.ownerId,
        type: "property.rejected",
        title: "Property rejected",
        message: `Your property "${property.title}" was rejected. Reason: ${rejectionReason}`,
        sendEmail: true
    });

    return updated;
}
