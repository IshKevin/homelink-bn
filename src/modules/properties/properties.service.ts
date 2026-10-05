import { and, desc, eq, gte, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../database";
import { floors, leases, properties, propertyImages, propertyUnits, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { buildObjectKey, deleteObject, getPresignedDownloadUrl, uploadBuffer } from "../../services/storage.service";
import { buildExcelBuffer, readExcelRows } from "../../services/excel.service";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";
import { isAdminRole, resolveEffectiveOwnerId } from "../../services/iam.service";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type PropertyRow = typeof properties.$inferSelect;
type PropertyUnitRow = typeof propertyUnits.$inferSelect;
type FloorRow = typeof floors.$inferSelect;

/** 0 -> "Ground", N -> "Floor N" — the auto-naming convention for a newly created floor. */
function floorName(index: number): string {
    return index === 0 ? "Ground" : `Floor ${index}`;
}

export interface CreatePropertyInput {
    title: string;
    type: PropertyRow["type"];
    location: string;
    numberOfFloors: number;
    ownerId?: string;
}

export interface UpdatePropertyInput {
    title?: string;
    type?: PropertyRow["type"];
    location?: string;
    status?: PropertyRow["status"];
}

export interface UpdateFloorInput {
    name?: string;
    scale?: number;
}

export interface CreateUnitInput {
    label: string;
    unitType?: string;
    description?: string;
    floorId: string;
    bedrooms?: number;
    bathrooms?: number;
    rentAmount: number;
    deposit?: number;
}

// "occupied" is deliberately not settable here — it's only ever set by
// initiateLeaseAssignment (createLease) or cleared by lease termination,
// never a manual landlord edit. See assertManualStatus below.
export type ManualUnitStatus = "available" | "maintenance" | "inactive";

export interface UpdateUnitInput {
    label?: string;
    unitType?: string;
    description?: string;
    floorId?: string;
    bedrooms?: number;
    bathrooms?: number;
    rentAmount?: number;
    deposit?: number;
    status?: ManualUnitStatus;
}

export interface GenerateUnitsInput {
    floorId: string;
    count: number;
    unitType?: string;
    bedrooms?: number;
    bathrooms?: number;
    rentAmount: number;
    deposit?: number;
}

export interface ListAvailableUnitsFilters {
    search?: string | undefined;
    status?: PropertyUnitRow["status"] | undefined;
    propertyId?: string | undefined;
}

export interface ListPropertiesFilters {
    status?: PropertyRow["status"] | undefined;
    approvalStatus?: PropertyRow["approvalStatus"] | undefined;
    type?: PropertyRow["type"] | undefined;
    search?: string | undefined;
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

/**
 * A tenant may read a property/its units even when it isn't publicly
 * approved+active, as long as they have a real lease on it — the
 * approved+active gate exists for public browsing, not for someone who's
 * already a legitimate party to that property via a lease.
 */
async function assertTenantPropertyReadAccess(property: PropertyRow, requester: Requester) {
    if (requester.role !== "tenant") return;
    if (property.approvalStatus === "approved" && property.isActive) return;

    const [ownLease] = await db
        .select({ id: leases.id })
        .from(leases)
        .where(and(eq(leases.propertyId, property.id), eq(leases.tenantId, requester.id)))
        .limit(1);
    if (!ownLease) throw AppError.notFound("Property not found");
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

    // Guards against a double-submit, a retried request, or two open tabs all
    // creating the same listing — the actual cause of a real incident where a
    // flaky submit produced 5 copies of the same property. Scoped to this
    // owner + title + location within a short window: long enough to absorb a
    // retry, short enough that genuinely re-listing the same address later
    // (e.g. a new build on the same plot) still goes through.
    const [recentDuplicate] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
            and(
                eq(properties.ownerId, ownerId),
                eq(properties.title, input.title),
                eq(properties.location, input.location),
                gte(properties.createdAt, new Date(Date.now() - 10_000))
            )
        )
        .limit(1);
    if (recentDuplicate) {
        throw AppError.conflict("This property was just created — check your properties list before submitting again.");
    }

    const { property } = await db.transaction(async (tx) => {
        const [createdProperty] = await tx
            .insert(properties)
            .values({
                ownerId,
                agentId,
                title: input.title,
                type: input.type,
                location: input.location,
                numberOfFloors: input.numberOfFloors,
                status: "available",
                approvalStatus: "pending"
            })
            .returning();

        if (!createdProperty) throw AppError.internal("Failed to create property");

        // One floor per the requested count, auto-named Ground/Floor 1/Floor 2/...
        // — no units yet, those are added afterward via the floor-scoped
        // create/generate endpoints below, matching the register-then-manage
        // workflow this is built around.
        await tx.insert(floors).values(
            Array.from({ length: input.numberOfFloors }, (_, index) => ({
                propertyId: createdProperty.id,
                name: floorName(index),
                index
            }))
        );

        return { property: createdProperty };
    });

    await recordAction({ userId: creator.id, action: "property.create", entity: "property", entityId: property.id });

    return property;
}

export async function updateProperty(propertyId: string, requester: Requester, input: UpdatePropertyInput) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);

    const updates: Partial<typeof properties.$inferInsert> = { ...input, updatedAt: new Date() };

    const [updated] = await db.update(properties).set(updates).where(eq(properties.id, propertyId)).returning();
    if (!updated) throw AppError.notFound("Property not found");

    await recordAction({ userId: requester.id, action: "property.update", entity: "property", entityId: propertyId });

    return updated;
}

// Deliberately narrow: this exists to let an owner/admin clean up a genuine
// accidental duplicate (e.g. a double-submitted create), not to remove a
// property with real history. leases.propertyId cascades at the DB level,
// so without this guard a delete here would silently wipe real tenants'
// lease/payment history — blocking on any lease ever having existed (even
// terminated ones) is intentional, not just "no active lease".
export async function deleteProperty(propertyId: string, requester: Requester): Promise<void> {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);

    const [existingLease] = await db.select({ id: leases.id }).from(leases).where(eq(leases.propertyId, propertyId)).limit(1);
    if (existingLease) {
        throw AppError.conflict(
            "This property has lease history and can't be deleted — deactivate it instead if it should no longer be listed."
        );
    }

    const [deleted] = await db.delete(properties).where(eq(properties.id, propertyId)).returning();
    if (!deleted) throw AppError.notFound("Property not found");

    await recordAction({ userId: requester.id, action: "property.delete", entity: "property", entityId: propertyId });
}

export async function listProperties(
    requester: Requester,
    filters: ListPropertiesFilters,
    pagination: { limit: number; offset: number }
) {
    const conditions = [];

    if (filters.status) conditions.push(eq(properties.status, filters.status));
    if (filters.approvalStatus) conditions.push(eq(properties.approvalStatus, filters.approvalStatus));
    if (filters.type) conditions.push(eq(properties.type, filters.type));
    if (filters.search) {
        const term = `%${filters.search}%`;
        conditions.push(or(ilike(properties.title, term), ilike(properties.location, term))!);
    }
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
        with: { images: true, units: true }
    });

    if (!property) throw AppError.notFound("Property not found");

    await assertTenantPropertyReadAccess(property, requester);

    const activeUnits = property.units.filter((unit) => !unit.deletedAt);

    return {
        ...property,
        units: activeUnits,
        totalUnits: activeUnits.length,
        occupiedUnits: activeUnits.filter((unit) => unit.status === "occupied").length,
        availableUnits: activeUnits.filter((unit) => unit.status === "available").length,
        maintenanceUnits: activeUnits.filter((unit) => unit.status === "maintenance").length,
        inactiveUnits: activeUnits.filter((unit) => unit.status === "inactive").length
    };
}

async function getFloorOrThrow(propertyId: string, floorId: string): Promise<FloorRow> {
    const [floor] = await db.select().from(floors).where(eq(floors.id, floorId)).limit(1);
    if (!floor || floor.propertyId !== propertyId) throw AppError.notFound("Floor not found");
    return floor;
}

export async function listFloors(propertyId: string, requester: Requester) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertTenantPropertyReadAccess(propertyRow, requester);

    const rows = await db.select().from(floors).where(eq(floors.propertyId, propertyId)).orderBy(floors.index);

    const counts = await db
        .select({ floorId: propertyUnits.floorId, count: sql<number>`count(*)::int` })
        .from(propertyUnits)
        .where(and(eq(propertyUnits.propertyId, propertyId), isNull(propertyUnits.deletedAt)))
        .groupBy(propertyUnits.floorId);
    const countByFloor = new Map(counts.map((c) => [c.floorId, c.count]));

    return rows.map((floor) => ({ ...floor, unitsCount: countByFloor.get(floor.id) ?? 0 }));
}

export async function updateFloor(propertyId: string, floorId: string, requester: Requester, input: UpdateFloorInput) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(propertyRow, requester);
    await getFloorOrThrow(propertyId, floorId);

    const updates: Partial<typeof floors.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.scale !== undefined) updates.scale = String(input.scale);

    const [updated] = await db.update(floors).set(updates).where(eq(floors.id, floorId)).returning();
    if (!updated) throw AppError.internal("Failed to update floor");

    await recordAction({ userId: requester.id, action: "property.floor.update", entity: "property", entityId: propertyId, metadata: { floorId } });

    return updated;
}

export async function listUnitsByFloor(propertyId: string, floorId: string, requester: Requester) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertTenantPropertyReadAccess(propertyRow, requester);
    await getFloorOrThrow(propertyId, floorId);

    return db
        .select()
        .from(propertyUnits)
        .where(and(eq(propertyUnits.floorId, floorId), isNull(propertyUnits.deletedAt)))
        .orderBy(desc(propertyUnits.createdAt));
}

export async function recomputePropertyStatus(propertyId: string): Promise<void> {
    const units = await db
        .select()
        .from(propertyUnits)
        .where(and(eq(propertyUnits.propertyId, propertyId), isNull(propertyUnits.deletedAt)));
    const hasAvailableUnit = units.length === 0 || units.some((unit) => unit.status === "available");

    await db
        .update(properties)
        .set({ status: hasAvailableUnit ? "available" : "occupied", updatedAt: new Date() })
        .where(eq(properties.id, propertyId));
}

async function getUnitOrThrow(unitId: string): Promise<PropertyUnitRow> {
    const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unitId)).limit(1);
    if (!unit || unit.deletedAt) throw AppError.notFound("Unit not found");
    return unit;
}

/**
 * Unit numbers/labels must be unique among a property's non-archived units
 * (a database constraint backs this too — property_units_property_id_label_idx,
 * scoped the same way — this is just what turns that into a clean 409
 * instead of a raw constraint error surfacing to the client).
 */
async function assertNoDuplicateLabel(propertyId: string, label: string, excludeUnitId?: string): Promise<void> {
    const conditions = [eq(propertyUnits.propertyId, propertyId), eq(propertyUnits.label, label), isNull(propertyUnits.deletedAt)];
    const [existing] = await db.select({ id: propertyUnits.id }).from(propertyUnits).where(and(...conditions)).limit(1);
    if (existing && existing.id !== excludeUnitId) {
        throw AppError.conflict(`Unit number "${label}" already exists in this property`);
    }
}

/** Batch version for generate/import — one query instead of one per label. */
async function findDuplicateLabels(propertyId: string, labels: string[]): Promise<string[]> {
    if (labels.length === 0) return [];
    const existingRows = await db
        .select({ label: propertyUnits.label })
        .from(propertyUnits)
        .where(and(eq(propertyUnits.propertyId, propertyId), inArray(propertyUnits.label, labels), isNull(propertyUnits.deletedAt)));
    return existingRows.map((r) => r.label);
}

export async function createUnit(propertyId: string, requester: Requester, input: CreateUnitInput) {
    const property = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    const [propertyRow] = property;
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(propertyRow, requester);
    await getFloorOrThrow(propertyId, input.floorId);
    await assertNoDuplicateLabel(propertyId, input.label);

    const [unit] = await db
        .insert(propertyUnits)
        .values({
            propertyId,
            label: input.label,
            unitType: input.unitType,
            description: input.description,
            floorId: input.floorId,
            bedrooms: input.bedrooms !== undefined ? String(input.bedrooms) : undefined,
            bathrooms: input.bathrooms !== undefined ? String(input.bathrooms) : undefined,
            rentAmount: String(input.rentAmount),
            deposit: input.deposit !== undefined ? String(input.deposit) : undefined,
            status: "available"
        })
        .returning();

    if (!unit) throw AppError.internal("Failed to create unit");

    await recomputePropertyStatus(propertyId);
    await recordAction({ userId: requester.id, action: "property.unit.create", entity: "property", entityId: propertyId });

    return unit;
}

export async function listUnits(propertyId: string, requester: Requester) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertTenantPropertyReadAccess(propertyRow, requester);

    return db
        .select()
        .from(propertyUnits)
        .where(and(eq(propertyUnits.propertyId, propertyId), isNull(propertyUnits.deletedAt)))
        .orderBy(desc(propertyUnits.createdAt));
}

/**
 * Single-unit detail view — the unit itself plus its floor and (if occupied)
 * its current tenant, so a landlord clicking into one unit sees everything
 * at a glance. Payment/maintenance/lease history live behind their own
 * `unitId`-filtered endpoints rather than being inlined here, same pattern
 * the rest of this app already uses for "related data" instead of building
 * combined payloads.
 */
export async function getUnitById(propertyId: string, unitId: string, requester: Requester) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertTenantPropertyReadAccess(propertyRow, requester);

    const unit = await getUnitOrThrow(unitId);
    if (unit.propertyId !== propertyId) throw AppError.notFound("Unit not found");

    // "occupied" doesn't guarantee lease.status === "active" — a unit becomes
    // occupied the moment a lease is assigned, before signatures (see
    // leases.service.ts's createLease) — so the "current" lease is whichever
    // one hasn't reached a terminal state yet, not strictly the active one.
    const [floor, [currentLease]] = await Promise.all([
        unit.floorId ? db.select().from(floors).where(eq(floors.id, unit.floorId)).limit(1).then((r) => r[0]) : undefined,
        unit.status === "occupied"
            ? db
                  .select({ id: leases.id, tenantId: leases.tenantId, status: leases.status, startDate: leases.startDate, endDate: leases.endDate })
                  .from(leases)
                  .where(and(eq(leases.unitId, unitId), notInArray(leases.status, ["terminated", "expired"])))
                  .orderBy(desc(leases.createdAt))
                  .limit(1)
            : []
    ]);

    return { ...unit, floor, currentLease };
}

export async function updateUnit(propertyId: string, unitId: string, requester: Requester, input: UpdateUnitInput) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(propertyRow, requester);

    const unit = await getUnitOrThrow(unitId);
    if (unit.propertyId !== propertyId) throw AppError.notFound("Unit not found");

    if (input.label && input.label !== unit.label) {
        await assertNoDuplicateLabel(propertyId, input.label, unitId);
    }
    if (input.floorId) {
        await getFloorOrThrow(propertyId, input.floorId);
    }

    // "occupied" isn't reachable through here at all — UpdateUnitInput's
    // status is typed to ManualUnitStatus, which excludes it. A unit only
    // becomes occupied via a lease assignment (createLease) and only
    // becomes available again via lease termination — never a direct manual
    // edit, even back to "available", since that would let a second tenant
    // be assigned on top of an existing lease.
    if (unit.status === "occupied" && input.status) {
        throw AppError.conflict("This unit currently has an active tenant — end that lease before changing its status");
    }

    const { bedrooms, bathrooms, rentAmount, deposit, ...rest } = input;
    const updates: Partial<typeof propertyUnits.$inferInsert> = { ...rest };
    if (bedrooms !== undefined) updates.bedrooms = String(bedrooms);
    if (bathrooms !== undefined) updates.bathrooms = String(bathrooms);
    if (rentAmount !== undefined) updates.rentAmount = String(rentAmount);
    if (deposit !== undefined) updates.deposit = String(deposit);
    updates.updatedAt = new Date();

    const [updated] = await db.update(propertyUnits).set(updates).where(eq(propertyUnits.id, unitId)).returning();
    if (!updated) throw AppError.internal("Failed to update unit");

    await recordAction({ userId: requester.id, action: "property.unit.update", entity: "property", entityId: propertyId, metadata: { unitId } });

    return updated;
}

/**
 * Deletion is a soft-delete (deletedAt), never a real row delete — a unit
 * can have lease/invoice/payment history hanging off it (leases.unitId), and
 * a hard delete would either cascade that history away or fail outright.
 * Archived units drop out of listUnits/listAvailableUnits/property counts,
 * but stay in the database exactly like a terminated lease does.
 */
export async function deleteUnit(propertyId: string, unitId: string, requester: Requester): Promise<void> {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(propertyRow, requester);

    const unit = await getUnitOrThrow(unitId);
    if (unit.propertyId !== propertyId) throw AppError.notFound("Unit not found");

    if (unit.status === "occupied") {
        throw AppError.conflict("This unit currently has an active tenant — end that lease before deleting it");
    }

    await db.update(propertyUnits).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(propertyUnits.id, unitId));

    await recomputePropertyStatus(propertyId);
    await recordAction({ userId: requester.id, action: "property.unit.delete", entity: "property", entityId: propertyId, metadata: { unitId } });
}

/**
 * Bulk-creates `count` units on one floor with a shared default
 * price/bedrooms/bathrooms — for buildings where entering each unit by hand
 * isn't practical. Called once per floor (e.g. Ground=7, Floor 1=10, Floor
 * 2=8) rather than taking a floor count itself, since floors are now real
 * entities created at property registration, not synthesized here. The
 * owner edits individual unit prices afterward via the existing updateUnit
 * above; this deliberately doesn't take a per-unit price list (see
 * importUnitsFromExcel for that).
 */
export async function generateUnits(propertyId: string, requester: Requester, input: GenerateUnitsInput) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");
    await assertPropertyWriteAccess(propertyRow, requester);
    const floor = await getFloorOrThrow(propertyId, input.floorId);

    const bedrooms = input.bedrooms !== undefined ? String(input.bedrooms) : undefined;
    const bathrooms = input.bathrooms !== undefined ? String(input.bathrooms) : undefined;
    const rentAmount = String(input.rentAmount);
    const deposit = input.deposit !== undefined ? String(input.deposit) : undefined;

    const values: (typeof propertyUnits.$inferInsert)[] = Array.from({ length: input.count }, (_, i) => ({
        propertyId,
        label: `${floor.name} - Unit ${i + 1}`,
        unitType: input.unitType,
        floorId: floor.id,
        bedrooms,
        bathrooms,
        rentAmount,
        deposit,
        status: "available"
    }));

    const duplicates = await findDuplicateLabels(propertyId, values.map((v) => v.label));
    if (duplicates.length > 0) {
        throw AppError.conflict(
            `${duplicates.length} generated unit number(s) already exist in this property: ${duplicates.join(", ")}. Remove or rename the existing ones first.`
        );
    }

    const created = await db.insert(propertyUnits).values(values).returning();

    await recordAction({
        userId: requester.id,
        action: "property.units.generate",
        entity: "property",
        entityId: propertyId,
        metadata: { count: created.length }
    });

    return created;
}

const importUnitRowSchema = z.object({
    label: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(100)),
    unitType: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    // Resolved against the property's existing floor names (case-insensitive)
    // in parseUnitsWorkbook below — floors must already exist (created at
    // property registration), this just matches a row to one by name.
    floor: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
    bedrooms: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().nonnegative()).optional(),
    bathrooms: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().nonnegative()).optional(),
    rentAmount: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().positive()),
    deposit: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().nonnegative()).optional(),
    // "occupied" is deliberately not accepted from a spreadsheet — there's no
    // real tenant assignment behind an imported row, only a real lease can
    // make a unit occupied. Blank/unrecognized status defaults to available.
    status: z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(["available", "maintenance", "inactive"]))
        .optional()
});

export interface ImportUnitRowError {
    row: number;
    message: string;
}

export interface ParsedImportRows {
    values: (typeof propertyUnits.$inferInsert)[];
    errors: ImportUnitRowError[];
}

/**
 * Shared by importUnitsFromExcel (commits) and previewImportUnitsFromExcel
 * (dry-run) — parses + validates every row, including duplicate-label
 * detection both within the file itself and against units the property
 * already has. Never touches the database.
 */
async function parseUnitsWorkbook(propertyId: string, fileBuffer: Buffer): Promise<ParsedImportRows> {
    const rawRows = await readExcelRows(fileBuffer);
    if (rawRows.length === 0) {
        throw AppError.badRequest("The uploaded file has no data rows");
    }

    const propertyFloors = await db.select().from(floors).where(eq(floors.propertyId, propertyId));
    const floorIdByName = new Map(propertyFloors.map((f) => [f.name.toLowerCase(), f.id]));

    const values: (typeof propertyUnits.$inferInsert)[] = [];
    const errors: ImportUnitRowError[] = [];
    const labelsSeenInFile = new Map<string, number>(); // label -> first row number seen

    rawRows.forEach((raw, index) => {
        const rowNumber = index + 2; // row 1 is the header
        const result = importUnitRowSchema.safeParse({
            label: raw["label"] ?? raw["unit number"] ?? raw["unit name"],
            unitType: raw["unittype"] ?? raw["unit type"],
            description: raw["description"],
            floor: raw["floor"],
            bedrooms: raw["bedrooms"],
            bathrooms: raw["bathrooms"],
            rentAmount: raw["rentamount"] ?? raw["rent amount"] ?? raw["monthly rent"] ?? raw["rent"],
            deposit: raw["deposit"],
            status: raw["status"]
        });

        if (!result.success) {
            errors.push({ row: rowNumber, message: result.error.issues.map((issue) => issue.message).join("; ") });
            return;
        }

        const firstSeenAt = labelsSeenInFile.get(result.data.label);
        if (firstSeenAt !== undefined) {
            errors.push({ row: rowNumber, message: `Duplicate unit number "${result.data.label}" (also on row ${firstSeenAt})` });
            return;
        }
        labelsSeenInFile.set(result.data.label, rowNumber);

        const floorId = floorIdByName.get(result.data.floor.toLowerCase());
        if (!floorId) {
            errors.push({ row: rowNumber, message: `Floor "${result.data.floor}" does not exist on this property` });
            return;
        }

        values.push({
            propertyId,
            label: result.data.label,
            unitType: result.data.unitType,
            description: result.data.description,
            floorId,
            bedrooms: result.data.bedrooms !== undefined ? String(result.data.bedrooms) : undefined,
            bathrooms: result.data.bathrooms !== undefined ? String(result.data.bathrooms) : undefined,
            rentAmount: String(result.data.rentAmount),
            deposit: result.data.deposit !== undefined ? String(result.data.deposit) : undefined,
            status: result.data.status ?? "available"
        });
    });

    const duplicatesInDb = await findDuplicateLabels(propertyId, values.map((v) => v.label));
    if (duplicatesInDb.length > 0) {
        for (const [rowIndex, value] of values.entries()) {
            if (duplicatesInDb.includes(value.label)) {
                errors.push({ row: rowIndex + 2, message: `Unit number "${value.label}" already exists in this property` });
            }
        }
    }

    return { values, errors };
}

/**
 * Parses and validates an uploaded .xlsx file WITHOUT creating anything —
 * lets the frontend show the landlord a preview (valid rows + row-level
 * errors) before they confirm. Confirming re-submits the same file to
 * importUnitsFromExcel.
 */
export async function previewImportUnitsFromExcel(
    propertyId: string,
    requester: Requester,
    fileBuffer: Buffer
): Promise<ParsedImportRows> {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");
    await assertPropertyWriteAccess(propertyRow, requester);

    return parseUnitsWorkbook(propertyId, fileBuffer);
}

const UNIT_IMPORT_COLUMNS = [
    { header: "Unit Number", key: "label", width: 18 },
    { header: "Unit Type", key: "unitType", width: 18 },
    { header: "Floor", key: "floor", width: 10 },
    { header: "Bedrooms", key: "bedrooms", width: 12 },
    { header: "Bathrooms", key: "bathrooms", width: 12 },
    { header: "Monthly Rent", key: "rentAmount", width: 15 },
    { header: "Deposit", key: "deposit", width: 15 },
    { header: "Description", key: "description", width: 30 },
    { header: "Status", key: "status", width: 14 }
];

/** Downloadable starting point for importUnitsFromExcel — same columns, one example row. */
export async function getUnitsImportTemplate(): Promise<Buffer> {
    return buildExcelBuffer("Units", UNIT_IMPORT_COLUMNS, [
        {
            label: "A001",
            unitType: "2 Bedroom",
            floor: "Ground",
            bedrooms: 2,
            bathrooms: 1,
            rentAmount: 150000,
            deposit: 150000,
            description: "Corner unit, street-facing",
            status: "available"
        }
    ]);
}

/**
 * Imports one unit per data row from an uploaded .xlsx file — header row
 * (case-insensitive): label (or "unit number"/"unit name"), unitType, floor,
 * bedrooms, bathrooms, rentAmount, deposit, description, status. Unlike
 * generateUnits, each row carries its own price, matching a landlord's real
 * rent roll rather than a single shared default. All-or-nothing: if any row
 * fails validation (including a duplicate unit number), nothing is imported.
 */
export async function importUnitsFromExcel(propertyId: string, requester: Requester, fileBuffer: Buffer) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");
    await assertPropertyWriteAccess(propertyRow, requester);

    const { values, errors } = await parseUnitsWorkbook(propertyId, fileBuffer);

    if (errors.length > 0) {
        throw AppError.badRequest("Some rows in the file are invalid — nothing was imported", errors);
    }

    const created = await db.transaction(async (tx) => tx.insert(propertyUnits).values(values).returning());

    await recordAction({
        userId: requester.id,
        action: "property.units.import",
        entity: "property",
        entityId: propertyId,
        metadata: { count: created.length }
    });

    return created;
}

/**
 * Cross-property unit search, scoped like listProperties — for a unit
 * picker (e.g. assigning a new tenant to a unit) rather than browsing one
 * property's units. Registered at GET /properties/units, before GET /:id,
 * so Express doesn't treat "units" as a property id.
 */
export async function listAvailableUnits(requester: Requester, filters: ListAvailableUnitsFilters) {
    const conditions = [eq(propertyUnits.status, filters.status ?? "available"), isNull(propertyUnits.deletedAt)];
    if (filters.propertyId) conditions.push(eq(propertyUnits.propertyId, filters.propertyId));
    if (filters.search) {
        const term = `%${filters.search}%`;
        conditions.push(or(ilike(propertyUnits.label, term), ilike(properties.title, term))!);
    }

    if (requester.role === "owner") {
        conditions.push(eq(properties.ownerId, requester.id));
    } else if (requester.role === "house_manager") {
        conditions.push(eq(properties.ownerId, await resolveEffectiveOwnerId(requester)));
    } else if (requester.role === "agent") {
        conditions.push(eq(properties.agentId, requester.id));
    } else if (!isAdminRole(requester.role)) {
        throw AppError.forbidden("You do not have permission to search units");
    }

    const rows = await db
        .select({
            id: propertyUnits.id,
            propertyId: propertyUnits.propertyId,
            label: propertyUnits.label,
            unitType: propertyUnits.unitType,
            description: propertyUnits.description,
            floorId: propertyUnits.floorId,
            bedrooms: propertyUnits.bedrooms,
            bathrooms: propertyUnits.bathrooms,
            rentAmount: propertyUnits.rentAmount,
            deposit: propertyUnits.deposit,
            status: propertyUnits.status,
            propertyTitle: properties.title,
            propertyLocation: properties.location
        })
        .from(propertyUnits)
        .innerJoin(properties, eq(propertyUnits.propertyId, properties.id))
        .where(and(...conditions))
        .orderBy(desc(propertyUnits.createdAt))
        .limit(100);

    return rows;
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

export async function setPropertyDocument(propertyId: string, requester: Requester, file: Express.Multer.File) {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);

    if (property.documentUrl) {
        await deleteObject(property.documentUrl).catch(() => undefined);
    }

    const key = buildObjectKey("property-documents", file.originalname);
    const url = await uploadBuffer(key, file.buffer, file.mimetype);

    const [updated] = await db
        .update(properties)
        .set({ documentUrl: url, updatedAt: new Date() })
        .where(eq(properties.id, propertyId))
        .returning();

    if (!updated) throw AppError.internal("Failed to save property document");

    await recordAction({ userId: requester.id, action: "property.document.set", entity: "property", entityId: propertyId });

    return updated;
}

export async function getPropertyDocument(propertyId: string, requester: Requester): Promise<{ url: string }> {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    // This is a legal ownership document (e.g. title deed), not marketplace
    // browsing data — unlike getPropertyById, tenants get no special-cased
    // access here at all, same circle as setPropertyDocument/deletePropertyDocument.
    await assertPropertyWriteAccess(property, requester);
    if (!property.documentUrl) throw AppError.notFound("This property has no document");

    return { url: await getPresignedDownloadUrl(property.documentUrl) };
}

export async function deletePropertyDocument(propertyId: string, requester: Requester): Promise<void> {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!property) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(property, requester);
    if (!property.documentUrl) throw AppError.notFound("This property has no document");

    await deleteObject(property.documentUrl).catch(() => undefined);
    await db.update(properties).set({ documentUrl: null, updatedAt: new Date() }).where(eq(properties.id, propertyId));

    await recordAction({ userId: requester.id, action: "property.document.delete", entity: "property", entityId: propertyId });
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
