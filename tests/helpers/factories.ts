import { faker } from "@faker-js/faker";
import { eq } from "drizzle-orm";
import { db } from "../../src/database";
import { floors, invoices, leases, maintenanceRequests, payments, properties, propertyUnits, users } from "../../src/database/schema";
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
    type?: "apartment" | "house" | "studio" | "condo" | "commercial" | "other";
    location?: string;
    numberOfFloors?: number;
    numberOfBasementFloors?: number;
    status?: "available" | "occupied";
    approvalStatus?: "pending" | "approved" | "rejected";
    isActive?: boolean;
    // Convenience only — not a real property field. Sets the auto-created
    // Ground floor's single default unit's bedrooms/bathrooms/rentAmount, so
    // existing tests that asserted on a property's "default unit" still can.
    rentAmount?: number;
    bedrooms?: number;
    bathrooms?: number;
    // Set false to skip the auto-created default unit — e.g. for tests that
    // assert on exactly which units exist on a floor.
    withDefaultUnit?: boolean;
}

export async function createProperty(overrides: CreatePropertyOverrides) {
    const bedrooms = overrides.bedrooms !== undefined ? String(overrides.bedrooms) : "2";
    const bathrooms = overrides.bathrooms !== undefined ? String(overrides.bathrooms) : "1";
    const rentAmount = overrides.rentAmount !== undefined ? String(overrides.rentAmount) : "1000";

    const [property] = await db
        .insert(properties)
        .values({
            ownerId: overrides.ownerId,
            agentId: overrides.agentId ?? undefined,
            title: overrides.title ?? faker.lorem.words(3),
            type: overrides.type ?? "apartment",
            location: overrides.location ?? `${faker.location.streetAddress()}, ${faker.location.city()}`,
            numberOfFloors: overrides.numberOfFloors ?? 1,
            numberOfBasementFloors: overrides.numberOfBasementFloors ?? 0,
            status: overrides.status ?? "available",
            approvalStatus: overrides.approvalStatus ?? "pending",
            isActive: overrides.isActive ?? true
        })
        .returning();

    if (!property) throw new Error("Failed to create test property");

    const floorCount = overrides.numberOfFloors ?? 1;
    const basementCount = overrides.numberOfBasementFloors ?? 0;
    const createdFloors = await db
        .insert(floors)
        .values([
            ...Array.from({ length: floorCount }, (_, index) => ({
                propertyId: property.id,
                name: index === 0 ? "Ground" : `Floor ${index}`,
                index
            })),
            ...Array.from({ length: basementCount }, (_, i) => ({
                propertyId: property.id,
                name: `Basement ${i + 1}`,
                index: -(i + 1)
            }))
        ])
        .returning();
    const groundFloor = createdFloors.find((f) => f.index === 0);
    if (!groundFloor) throw new Error("Failed to create test property's ground floor");

    if (overrides.withDefaultUnit ?? true) {
        await db.insert(propertyUnits).values({
            propertyId: property.id,
            floorId: groundFloor.id,
            label: property.title,
            bedrooms,
            bathrooms,
            rentAmount,
            status: overrides.status ?? "available"
        });
    }

    return property;
}

async function getOrCreateUnit(propertyId: string): Promise<string> {
    const [existing] = await db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, propertyId)).limit(1);
    if (existing) return existing.id;

    let [groundFloor] = await db.select().from(floors).where(eq(floors.propertyId, propertyId)).limit(1);
    if (!groundFloor) {
        [groundFloor] = await db.insert(floors).values({ propertyId, name: "Ground", index: 0 }).returning();
    }
    if (!groundFloor) throw new Error("Failed to create test property's ground floor");

    const [unit] = await db
        .insert(propertyUnits)
        .values({ propertyId, floorId: groundFloor.id, label: "Unit 1", rentAmount: "1000", status: "available" })
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

export interface CreatePaymentOverrides {
    invoiceId: string;
    tenantId: string;
    amount?: string | number;
    method?: "mobile_money" | "bank_transfer" | "cash";
    status?: "pending" | "success" | "failed";
    paidAt?: Date | null;
}

export async function createPayment(overrides: CreatePaymentOverrides) {
    const paymentNumber = await nextDocumentNumber("ACC-PAY");
    const [payment] = await db
        .insert(payments)
        .values({
            paymentNumber,
            invoiceId: overrides.invoiceId,
            tenantId: overrides.tenantId,
            amount: overrides.amount !== undefined ? String(overrides.amount) : "1200.00",
            method: overrides.method ?? "mobile_money",
            provider: "test",
            providerReference: faker.string.alphanumeric(10).toUpperCase(),
            status: overrides.status ?? "success",
            paidAt: overrides.status === "failed" ? undefined : (overrides.paidAt ?? new Date())
        })
        .returning();

    if (!payment) throw new Error("Failed to create test payment");
    return payment;
}

export interface CreateMaintenanceRequestOverrides {
    propertyId: string;
    unitId?: string;
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
            unitId: overrides.unitId,
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
