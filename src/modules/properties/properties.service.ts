import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../database";
import { properties, propertyImages, propertyUnits, users } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { buildObjectKey, deleteObject, getPresignedDownloadUrl, uploadBuffer } from "../../services/storage.service";
import { buildExcelBuffer, readExcelRows } from "../../services/excel.service";
import { recordAction } from "../../services/audit.service";
import { notify } from "../../services/notification.service";
import { isAdminRole, resolveEffectiveOwnerId } from "../../services/iam.service";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

type PropertyRow = typeof properties.$inferSelect;
type PropertyUnitRow = typeof propertyUnits.$inferSelect;

export interface CreatePropertyInput {
    title: string;
    description?: string;
    type: PropertyRow["type"];
    category: PropertyRow["category"];
    sizeSqm?: number;
    unitsCount?: number;
    upi?: string;
    terms?: string[];
    attributes?: { label: string; value: string }[];
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
    upi?: string;
    terms?: string[];
    attributes?: { label: string; value: string }[];
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

export interface CreateUnitInput {
    label: string;
    unitType?: string;
    description?: string;
    floor?: number;
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
    floor?: number;
    bedrooms?: number;
    bathrooms?: number;
    rentAmount?: number;
    deposit?: number;
    status?: ManualUnitStatus;
}

export interface GenerateUnitsInput {
    count: number;
    floors?: number;
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
            upi: input.upi,
            terms: input.terms,
            attributes: input.attributes,
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

    await db.insert(propertyUnits).values({
        propertyId: property.id,
        label: property.title,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        rentAmount: property.rentAmount,
        status: "available"
    });

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
    if (filters.approvalStatus) conditions.push(eq(properties.approvalStatus, filters.approvalStatus));
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
        with: { images: true, units: true }
    });

    if (!property) throw AppError.notFound("Property not found");

    if (requester.role === "tenant" && !(property.approvalStatus === "approved" && property.isActive)) {
        throw AppError.notFound("Property not found");
    }

    return {
        ...property,
        totalUnits: property.units.length,
        occupiedUnits: property.units.filter((unit) => unit.status === "occupied").length
    };
}

export async function recomputePropertyStatus(propertyId: string): Promise<void> {
    const units = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, propertyId));
    const hasAvailableUnit = units.length === 0 || units.some((unit) => unit.status === "available");

    await db
        .update(properties)
        .set({ status: hasAvailableUnit ? "available" : "occupied", updatedAt: new Date() })
        .where(eq(properties.id, propertyId));
}

async function getUnitOrThrow(unitId: string): Promise<PropertyUnitRow> {
    const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unitId)).limit(1);
    if (!unit) throw AppError.notFound("Unit not found");
    return unit;
}

/**
 * Unit numbers/labels must be unique within a property (a database
 * constraint backs this too — property_units_property_id_label_idx — this
 * is just what turns that into a clean 409 instead of a raw constraint
 * error surfacing to the client).
 */
async function assertNoDuplicateLabel(propertyId: string, label: string, excludeUnitId?: string): Promise<void> {
    const conditions = [eq(propertyUnits.propertyId, propertyId), eq(propertyUnits.label, label)];
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
        .where(and(eq(propertyUnits.propertyId, propertyId), inArray(propertyUnits.label, labels)));
    return existingRows.map((r) => r.label);
}

export async function createUnit(propertyId: string, requester: Requester, input: CreateUnitInput) {
    const property = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    const [propertyRow] = property;
    if (!propertyRow) throw AppError.notFound("Property not found");

    await assertPropertyWriteAccess(propertyRow, requester);
    await assertNoDuplicateLabel(propertyId, input.label);

    const [unit] = await db
        .insert(propertyUnits)
        .values({
            propertyId,
            label: input.label,
            unitType: input.unitType,
            description: input.description,
            floor: input.floor,
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

    if (requester.role === "tenant" && !(propertyRow.approvalStatus === "approved" && propertyRow.isActive)) {
        throw AppError.notFound("Property not found");
    }

    return db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, propertyId)).orderBy(desc(propertyUnits.createdAt));
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
 * Bulk-creates units with a shared default price/bedrooms/bathrooms — for
 * buildings where entering each unit by hand isn't practical. The owner
 * edits individual unit prices afterward via the existing updateUnit above;
 * this deliberately doesn't take a per-unit price list (see
 * importUnitsFromExcel for that).
 */
export async function generateUnits(propertyId: string, requester: Requester, input: GenerateUnitsInput) {
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
    if (!propertyRow) throw AppError.notFound("Property not found");
    await assertPropertyWriteAccess(propertyRow, requester);

    const bedrooms = input.bedrooms !== undefined ? String(input.bedrooms) : undefined;
    const bathrooms = input.bathrooms !== undefined ? String(input.bathrooms) : undefined;
    const rentAmount = String(input.rentAmount);
    const deposit = input.deposit !== undefined ? String(input.deposit) : undefined;

    const values: (typeof propertyUnits.$inferInsert)[] = [];
    if (input.floors) {
        const unitsPerFloor = Math.ceil(input.count / input.floors);
        let remaining = input.count;
        for (let floor = 1; floor <= input.floors && remaining > 0; floor++) {
            const onThisFloor = Math.min(unitsPerFloor, remaining);
            for (let unit = 1; unit <= onThisFloor; unit++) {
                values.push({
                    propertyId,
                    label: `Floor ${floor} - Unit ${unit}`,
                    unitType: input.unitType,
                    floor,
                    bedrooms,
                    bathrooms,
                    rentAmount,
                    deposit,
                    status: "available"
                });
            }
            remaining -= onThisFloor;
        }
    } else {
        for (let unit = 1; unit <= input.count; unit++) {
            values.push({ propertyId, label: `Unit ${unit}`, unitType: input.unitType, bedrooms, bathrooms, rentAmount, deposit, status: "available" });
        }
    }

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
    floor: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int()).optional(),
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

        values.push({
            propertyId,
            label: result.data.label,
            unitType: result.data.unitType,
            description: result.data.description,
            floor: result.data.floor,
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
            floor: 1,
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
    const conditions = [eq(propertyUnits.status, filters.status ?? "available")];
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
            floor: propertyUnits.floor,
            bedrooms: propertyUnits.bedrooms,
            bathrooms: propertyUnits.bathrooms,
            rentAmount: propertyUnits.rentAmount,
            status: propertyUnits.status,
            propertyTitle: properties.title,
            propertyAddressLine: properties.addressLine
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
