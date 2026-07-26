import { faker } from "@faker-js/faker";
import { eq } from "drizzle-orm";
import { db } from "../../src/database";
import { invoices, leases, maintenanceRequests, properties, propertyUnits, users } from "../../src/database/schema";
import { hashPassword } from "../../src/common/utils/password.util";
import { signAccessToken } from "../../src/common/utils/jwt.util";
import { nextDocumentNumber } from "../../src/common/utils/sequence.util";

export type UserRole = "tenant" | "owner" | "agent" | "admin" | "superadmin" | "house_manager";

export interface CreateUserOverrides {
    email?: string;
    role?: UserRole;
    password?: string;
    phone?: string;
    isApproved?: boolean;
    isVerified?: boolean;
}

export async function createUser(overrides: CreateUserOverrides = {}) {
    const password = overrides.password ?? "Password123!";
    const passwordHash = await hashPassword(password);
    const [user] = await db
        .insert(users)
        .values({
            email: overrides.email ?? faker.internet.email().toLowerCase(),
            passwordHash,
            role: overrides.role ?? "tenant",
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            phone: overrides.phone ?? faker.phone.number(),
            isApproved: overrides.isApproved ?? true,
            isVerified: overrides.isVerified ?? true
        })
        .returning();

    if (!user) throw new Error("Failed to create test user");
    return { user, password };
}

export function tokenFor(user: { id: string; role: string; email: string }): string {
    return signAccessToken({ sub: user.id, role: user.role, email: user.email });
}

export async function createAuthedUser(overrides: CreateUserOverrides = {}) {
    const { user, password } = await createUser(overrides);
    const accessToken = tokenFor(user);
    return { user, password, accessToken };
}

export interface CreatePropertyOverrides {
    ownerId: string;
    agentId?: string | null;
    title?: string;
    description?: string;
    type?: "apartment" | "house" | "studio" | "condo" | "commercial" | "other";
    category?: "residential" | "commercial";
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
    status?: "available" | "occupied";
    approvalStatus?: "pending" | "approved" | "rejected";
    isActive?: boolean;
}

export async function createProperty(overrides: CreatePropertyOverrides) {
    const type = overrides.type ?? "apartment";
    const bedrooms = overrides.bedrooms !== undefined ? String(overrides.bedrooms) : "2";
    const bathrooms = overrides.bathrooms !== undefined ? String(overrides.bathrooms) : "1";
    const rentAmount = overrides.rentAmount !== undefined ? String(overrides.rentAmount) : "1000";

    const [property] = await db
        .insert(properties)
        .values({
            ownerId: overrides.ownerId,
            agentId: overrides.agentId ?? undefined,
            title: overrides.title ?? faker.lorem.words(3),
            description: overrides.description ?? faker.lorem.sentence(),
            type,
            category: overrides.category ?? (type === "commercial" ? "commercial" : "residential"),
            sizeSqm: overrides.sizeSqm !== undefined ? String(overrides.sizeSqm) : type === "commercial" ? "100" : undefined,
            unitsCount: overrides.unitsCount,
            addressLine: overrides.addressLine ?? faker.location.streetAddress(),
            city: overrides.city ?? faker.location.city(),
            state: overrides.state ?? faker.location.state(),
            country: overrides.country ?? faker.location.country(),
            postalCode: overrides.postalCode ?? faker.location.zipCode(),
            bedrooms,
            bathrooms,
            rentAmount,
            rentConditions: overrides.rentConditions,
            status: overrides.status ?? "available",
            approvalStatus: overrides.approvalStatus ?? "pending",
            isActive: overrides.isActive ?? true
        })
        .returning();

    if (!property) throw new Error("Failed to create test property");

    await db.insert(propertyUnits).values({
        propertyId: property.id,
        label: property.title,
        bedrooms,
        bathrooms,
        rentAmount,
        status: overrides.status ?? "available"
    });

    return property;
}

async function getOrCreateUnit(propertyId: string): Promise<string> {
    const [existing] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, propertyId)).limit(1);
    if (existing) return existing.id;

    const [unit] = await db
        .insert(propertyUnits)
        .values({ propertyId, label: "Unit 1", rentAmount: "1000", status: "available" })
        .returning();
    if (!unit) throw new Error("Failed to create test unit");
    return unit.id;
}

export interface CreateLeaseOverrides {
    propertyId: string;
    unitId?: string;
    tenantId: string;
    ownerId: string;
    startDate?: string;
    endDate?: string;
    paymentDate?: string;
    rentAmount?: number;
    deposit?: number;
    momoNumber?: string;
    leasePeriodNote?: string;
    status?: "draft" | "pending_signatures" | "active" | "pending_renewal" | "pending_termination" | "terminated" | "expired";
    documentUrl?: string | null;
    tenantSignedAt?: Date | null;
    ownerSignedAt?: Date | null;
    terminatedAt?: Date | null;
}

export async function createLease(overrides: CreateLeaseOverrides) {
    const unitId = overrides.unitId ?? (await getOrCreateUnit(overrides.propertyId));

    const [lease] = await db
        .insert(leases)
        .values({
            propertyId: overrides.propertyId,
            unitId,
            tenantId: overrides.tenantId,
            ownerId: overrides.ownerId,
            startDate: overrides.startDate ?? "2026-01-01",
            endDate: overrides.endDate ?? "2026-12-31",
            paymentDate: overrides.paymentDate,
            rentAmount: overrides.rentAmount !== undefined ? String(overrides.rentAmount) : "1000",
            deposit: overrides.deposit !== undefined ? String(overrides.deposit) : undefined,
            momoNumber: overrides.momoNumber,
            leasePeriodNote: overrides.leasePeriodNote,
            status: overrides.status ?? "active",
            documentUrl: overrides.documentUrl ?? undefined,
            tenantSignedAt: overrides.tenantSignedAt ?? undefined,
            ownerSignedAt: overrides.ownerSignedAt ?? undefined,
            terminatedAt: overrides.terminatedAt ?? undefined
        })
        .returning();

    if (!lease) throw new Error("Failed to create test lease");
    return lease;
}

export interface CreateInvoiceOverrides {
    leaseId: string;
    period?: string;
    amountDue?: string | number;
    dueDate?: string;
    status?: "unpaid" | "paid" | "overdue";
}

export async function createInvoice(overrides: CreateInvoiceOverrides) {
    const invoiceNumber = await nextDocumentNumber("ACC-INV");
    const [invoice] = await db
        .insert(invoices)
        .values({
            invoiceNumber,
            leaseId: overrides.leaseId,
            period: overrides.period ?? "2026-01",
            amountDue: overrides.amountDue !== undefined ? String(overrides.amountDue) : "1200.00",
            dueDate: overrides.dueDate ?? "2026-01-01",
            status: overrides.status ?? "unpaid"
        })
        .returning();

    if (!invoice) throw new Error("Failed to create test invoice");
    return invoice;
}

export interface CreateMaintenanceRequestOverrides {
    propertyId: string;
    tenantId: string;
    title?: string;
    description?: string;
    priority?: "low" | "medium" | "high";
    status?: "submitted" | "assigned" | "in_progress" | "completed";
    assignedTo?: string | null;
    itemsCost?: number | null;
    laborCost?: number | null;
    completionNotes?: string | null;
    completedAt?: Date | null;
}

export async function createMaintenanceRequest(overrides: CreateMaintenanceRequestOverrides) {
    const [request] = await db
        .insert(maintenanceRequests)
        .values({
            propertyId: overrides.propertyId,
            tenantId: overrides.tenantId,
            title: overrides.title ?? faker.lorem.words(4),
            description: overrides.description ?? faker.lorem.sentence(),
            priority: overrides.priority ?? "medium",
            status: overrides.status ?? "submitted",
            assignedTo: overrides.assignedTo ?? undefined,
            itemsCost: overrides.itemsCost !== undefined && overrides.itemsCost !== null ? String(overrides.itemsCost) : undefined,
            laborCost: overrides.laborCost !== undefined && overrides.laborCost !== null ? String(overrides.laborCost) : undefined,
            completionNotes: overrides.completionNotes ?? undefined,
            completedAt: overrides.completedAt ?? undefined
        })
        .returning();

    if (!request) throw new Error("Failed to create test maintenance request");
    return request;
}
