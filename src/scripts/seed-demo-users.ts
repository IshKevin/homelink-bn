import { and, eq } from "drizzle-orm";
import { format, subMonths, subDays } from "date-fns";
import { db, pool } from "../database";
import {
    users,
    managerAssignments,
    properties,
    propertyUnits,
    leases,
    invoices,
    payments,
    maintenanceRequests,
    maintenanceFeedback
} from "../database/schema";
import { hashPassword } from "../common/utils/password.util";
import { nextDocumentNumber } from "../common/utils/sequence.util";
import { generateInvoicesJob } from "../jobs/handlers/generateInvoices.job";
import { logger } from "../config/logger";

/**
 * Fixed, well-known demo accounts for frontend/manual testing — one per role.
 * Gated behind SEED_DEMO_USERS so it never runs against a real environment by accident.
 */
const DEMO_USERS = [
    {
        email: "tenant.demo@homelink.dev",
        password: "Demo@1234",
        role: "tenant" as const,
        firstName: "Tina",
        lastName: "Tenant",
        phone: "0700000001"
    },
    {
        email: "owner.demo@homelink.dev",
        password: "Demo@1234",
        role: "owner" as const,
        firstName: "Oscar",
        lastName: "Owner",
        phone: "0700000002"
    },
    {
        email: "agent.demo@homelink.dev",
        password: "Demo@1234",
        role: "agent" as const,
        firstName: "Aline",
        lastName: "Agent",
        phone: "0700000003"
    },
    {
        email: "manager.demo@homelink.dev",
        password: "Demo@1234",
        role: "house_manager" as const,
        firstName: "Marc",
        lastName: "Manager",
        phone: "0700000004"
    },
    {
        email: "admin.demo@homelink.dev",
        password: "Demo@1234",
        role: "admin" as const,
        firstName: "Ana",
        lastName: "Admin",
        phone: "0700000005"
    },
    {
        email: "superadmin.demo@homelink.dev",
        password: "Demo@1234",
        role: "superadmin" as const,
        firstName: "Sam",
        lastName: "Superadmin",
        phone: "0700000006"
    }
];

async function seedDemoUsers(): Promise<Record<string, string>> {
    const idByEmail: Record<string, string> = {};

    for (const demoUser of DEMO_USERS) {
        const passwordHash = await hashPassword(demoUser.password);
        const [existing] = await db.select().from(users).where(eq(users.email, demoUser.email)).limit(1);

        if (existing) {
            await db
                .update(users)
                .set({
                    passwordHash,
                    role: demoUser.role,
                    firstName: demoUser.firstName,
                    lastName: demoUser.lastName,
                    phone: demoUser.phone,
                    isActive: true,
                    isApproved: true,
                    isVerified: true
                })
                .where(eq(users.id, existing.id));
            idByEmail[demoUser.email] = existing.id;
            logger.info({ email: demoUser.email, role: demoUser.role }, "Existing demo user reset");
        } else {
            const [created] = await db
                .insert(users)
                .values({
                    email: demoUser.email,
                    passwordHash,
                    firstName: demoUser.firstName,
                    lastName: demoUser.lastName,
                    phone: demoUser.phone,
                    role: demoUser.role,
                    isApproved: true,
                    isVerified: true
                })
                .returning();
            idByEmail[demoUser.email] = created!.id;
            logger.info({ email: demoUser.email, role: demoUser.role }, "Demo user created");
        }
    }

    return idByEmail;
}

/**
 * Realistic demo content on top of the demo accounts: a manager assignment,
 * three properties (occupied, vacant, and pending admin approval), an active
 * lease with payment history, and maintenance requests in different states.
 * Every insert is guarded by a lookup on a natural key first, so re-running
 * this (e.g. on every deploy) never duplicates rows.
 */
async function seedDemoData(idByEmail: Record<string, string>): Promise<void> {
    const ownerId = idByEmail["owner.demo@homelink.dev"]!;
    const tenantId = idByEmail["tenant.demo@homelink.dev"]!;
    const agentId = idByEmail["agent.demo@homelink.dev"]!;
    const managerId = idByEmail["manager.demo@homelink.dev"]!;

    // Real payout number for owner.demo, so an actual MTN Disbursement can
    // be tested end-to-end once real credentials are configured — the mock
    // disbursement path (see payouts.service.ts) doesn't require this.
    await db.update(users).set({ payoutMomoNumber: "0780000099" }).where(eq(users.id, ownerId));
    const adminId = idByEmail["admin.demo@homelink.dev"]!;

    const [existingAssignment] = await db
        .select()
        .from(managerAssignments)
        .where(
            and(
                eq(managerAssignments.ownerId, ownerId),
                eq(managerAssignments.managerId, managerId),
                eq(managerAssignments.status, "active")
            )
        )
        .limit(1);
    if (!existingAssignment) {
        await db.insert(managerAssignments).values({
            ownerId,
            managerId,
            assignedBy: ownerId,
            status: "active"
        });
        logger.info("Demo manager assignment created (owner.demo -> manager.demo)");
    }

    async function findOrCreateProperty(input: {
        title: string;
        description: string;
        type: "apartment" | "house" | "studio";
        sizeSqm: string;
        bedrooms: string;
        bathrooms: string;
        addressLine: string;
        rentAmount: string;
        status: "available" | "occupied";
        approvalStatus: "pending" | "approved";
    }) {
        const [existing] = await db
            .select()
            .from(properties)
            .where(and(eq(properties.ownerId, ownerId), eq(properties.title, input.title)))
            .limit(1);
        if (existing) return existing;

        const [created] = await db
            .insert(properties)
            .values({
                ownerId,
                agentId,
                title: input.title,
                description: input.description,
                type: input.type,
                category: "residential",
                sizeSqm: input.sizeSqm,
                unitsCount: 1,
                addressLine: input.addressLine,
                city: "Kigali",
                country: "Rwanda",
                bedrooms: input.bedrooms,
                bathrooms: input.bathrooms,
                rentAmount: input.rentAmount,
                status: input.status,
                approvalStatus: input.approvalStatus,
                approvedBy: input.approvalStatus === "approved" ? adminId : null,
                approvedAt: input.approvalStatus === "approved" ? subDays(new Date(), 60) : null
            })
            .returning();
        logger.info({ title: input.title }, "Demo property created");
        return created!;
    }

    const leasedProperty = await findOrCreateProperty({
        title: "Kigali Heights Apartment",
        description: "Modern 2-bedroom apartment in Kigali Heights with secure parking and 24/7 water supply.",
        type: "apartment",
        sizeSqm: "85.00",
        bedrooms: "2",
        bathrooms: "1",
        addressLine: "KG 7 Ave, Kigali Heights",
        rentAmount: "250000",
        status: "occupied",
        approvalStatus: "approved"
    });

    await findOrCreateProperty({
        title: "Nyarutarama Villa",
        description: "Spacious 4-bedroom villa with a garden, ideal for families, near Nyarutarama golf course.",
        type: "house",
        sizeSqm: "220.00",
        bedrooms: "4",
        bathrooms: "3",
        addressLine: "KG 11 Ave, Nyarutarama",
        rentAmount: "600000",
        status: "available",
        approvalStatus: "approved"
    });

    await findOrCreateProperty({
        title: "Remera Studio",
        description: "Compact studio near Remera, awaiting admin approval — useful for demoing the approval queue.",
        type: "studio",
        sizeSqm: "35.00",
        bedrooms: "1",
        bathrooms: "1",
        addressLine: "KG 17 Ave, Remera",
        rentAmount: "120000",
        status: "available",
        approvalStatus: "pending"
    });

    let [unit] = await db
        .select()
        .from(propertyUnits)
        .where(and(eq(propertyUnits.propertyId, leasedProperty.id), eq(propertyUnits.label, "Unit A1")))
        .limit(1);
    if (!unit) {
        [unit] = await db
            .insert(propertyUnits)
            .values({
                propertyId: leasedProperty.id,
                label: "Unit A1",
                bedrooms: "2",
                bathrooms: "1",
                rentAmount: "250000",
                status: "occupied"
            })
            .returning();
        logger.info("Demo property unit created (Unit A1)");
    }

    const today = new Date();
    let [lease] = await db
        .select()
        .from(leases)
        .where(and(eq(leases.unitId, unit!.id), eq(leases.tenantId, tenantId)))
        .limit(1);
    if (!lease) {
        [lease] = await db
            .insert(leases)
            .values({
                propertyId: leasedProperty.id,
                unitId: unit!.id,
                tenantId,
                ownerId,
                startDate: format(subMonths(today, 6), "yyyy-MM-dd"),
                endDate: format(subMonths(today, -6), "yyyy-MM-dd"),
                paymentDate: format(today, "yyyy-MM-dd"),
                rentAmount: "250000",
                deposit: "250000",
                momoNumber: "0780000001",
                status: "active",
                documentsConfirmed: true,
                documentsConfirmedBy: managerId,
                documentsConfirmedAt: subMonths(today, 6),
                tenantSignedAt: subMonths(today, 6),
                ownerSignedAt: subMonths(today, 6)
            })
            .returning();
        logger.info("Demo lease created (tenant.demo @ Kigali Heights Apartment, Unit A1)");
    }

    // Last month's invoice, already paid — gives the demo real payment history
    // instead of only future/pending invoices.
    const lastPeriod = format(subMonths(today, 1), "yyyy-MM");
    let [pastInvoice] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.leaseId, lease!.id), eq(invoices.period, lastPeriod)))
        .limit(1);
    if (!pastInvoice) {
        const invoiceNumber = await nextDocumentNumber("ACC-INV", subMonths(today, 1));
        [pastInvoice] = await db
            .insert(invoices)
            .values({
                invoiceNumber,
                leaseId: lease!.id,
                period: lastPeriod,
                amountDue: "250000",
                dueDate: format(subMonths(today, 1), "yyyy-MM-dd"),
                status: "paid"
            })
            .returning();
        logger.info({ period: lastPeriod }, "Demo past invoice created");
    }

    const [existingPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, pastInvoice!.id))
        .limit(1);
    if (!existingPayment) {
        const paymentNumber = await nextDocumentNumber("ACC-PAY", subMonths(today, 1));
        await db.insert(payments).values({
            paymentNumber,
            invoiceId: pastInvoice!.id,
            tenantId,
            amount: "250000",
            method: "mobile_money",
            provider: "MTN MoMo",
            providerReference: `DEMO-MOMO-${format(subMonths(today, 1), "yyyyMM")}`,
            status: "success",
            approvalStatus: "not_required",
            paidAt: subMonths(today, 1)
        });
        logger.info("Demo payment created for last month's invoice");
    }

    // This month's invoice is normally created by the daily generateInvoices
    // cron job — run it once here so the demo shows an upcoming/due invoice
    // immediately instead of waiting for the next scheduled run.
    await generateInvoicesJob();

    const [existingOpenRequest] = await db
        .select()
        .from(maintenanceRequests)
        .where(and(eq(maintenanceRequests.propertyId, leasedProperty.id), eq(maintenanceRequests.title, "AC not cooling properly")))
        .limit(1);
    if (!existingOpenRequest) {
        await db.insert(maintenanceRequests).values({
            propertyId: leasedProperty.id,
            tenantId,
            title: "AC not cooling properly",
            description: "The living room AC unit runs but doesn't cool the room anymore.",
            priority: "high",
            status: "submitted"
        });
        logger.info("Demo open maintenance request created");
    }

    let [completedRequest] = await db
        .select()
        .from(maintenanceRequests)
        .where(and(eq(maintenanceRequests.propertyId, leasedProperty.id), eq(maintenanceRequests.title, "Leaking kitchen faucet")))
        .limit(1);
    if (!completedRequest) {
        [completedRequest] = await db
            .insert(maintenanceRequests)
            .values({
                propertyId: leasedProperty.id,
                tenantId,
                title: "Leaking kitchen faucet",
                description: "Water keeps dripping from the kitchen sink faucet even when fully closed.",
                priority: "medium",
                status: "completed",
                assignedTo: managerId,
                itemsCost: "15000",
                laborCost: "10000",
                completionNotes: "Replaced the worn washer and tightened the fitting.",
                completedAt: subDays(today, 10)
            })
            .returning();
        logger.info("Demo completed maintenance request created");
    }

    const [existingFeedback] = await db
        .select()
        .from(maintenanceFeedback)
        .where(eq(maintenanceFeedback.requestId, completedRequest!.id))
        .limit(1);
    if (!existingFeedback) {
        await db.insert(maintenanceFeedback).values({
            requestId: completedRequest!.id,
            rating: 5,
            comment: "Fixed quickly, thank you!"
        });
        logger.info("Demo maintenance feedback created");
    }
}

async function main() {
    if (process.env.SEED_DEMO_USERS !== "true") {
        logger.info("SEED_DEMO_USERS is not 'true', skipping demo user seed");
        return;
    }

    const idByEmail = await seedDemoUsers();
    await seedDemoData(idByEmail);

    logger.info(
        { users: DEMO_USERS.map((u) => ({ email: u.email, password: u.password, role: u.role })) },
        "Demo users and demo data ready"
    );
}

main()
    .catch((err) => {
        logger.error({ err }, "Failed to seed demo users/data");
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
