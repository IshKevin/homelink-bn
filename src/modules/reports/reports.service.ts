import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { differenceInCalendarDays, endOfYear, format, startOfYear } from "date-fns";
import { db } from "../../database";
import { invoices, leases, maintenanceRequests, payments, properties, users } from "../../database/schema";

export type Requester = Pick<Express.AuthUser, "id" | "role">;

export interface ReportColumn {
    header: string;
    key: string;
    width?: number;
}

export interface ReportResult {
    summary?: Record<string, unknown>;
    rows: Record<string, unknown>[];
    columns: ReportColumn[];
}

export interface ReportDateRangeInput {
    from?: string | undefined;
    to?: string | undefined;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Resolves the effective reporting window. Defaults to the current calendar
 * year when `from`/`to` are not supplied, matching dashboard.service.ts's
 * profit & loss statement convention.
 */
export function resolveDateRange(from?: string, to?: string): { start: Date; end: Date; periodFrom: string; periodTo: string } {
    const now = new Date();
    const start = from ? new Date(from) : startOfYear(now);
    const end = to ? new Date(`${to}T23:59:59`) : endOfYear(now);

    return {
        start,
        end,
        periodFrom: format(start, "yyyy-MM-dd"),
        periodTo: format(end, "yyyy-MM-dd")
    };
}

/* -------------------------------------------------------------------------- */
/* Rental history                                                              */
/* -------------------------------------------------------------------------- */

export async function getRentalHistoryReport(requester: Requester, { from, to }: ReportDateRangeInput): Promise<ReportResult> {
    const { periodFrom, periodTo } = resolveDateRange(from, to);

    const conditions = [lte(leases.startDate, periodTo), gte(leases.endDate, periodFrom)];

    if (requester.role === "tenant") {
        conditions.push(eq(leases.tenantId, requester.id));
    } else if (requester.role === "owner") {
        conditions.push(eq(leases.ownerId, requester.id));
    }

    const rows = await db
        .select({ lease: leases, property: properties })
        .from(leases)
        .innerJoin(properties, eq(leases.propertyId, properties.id))
        .where(and(...conditions))
        .orderBy(desc(leases.startDate));

    const reportRows = rows.map((r) => ({
        Property: r.property.title,
        Address: `${r.property.addressLine}, ${r.property.city}`,
        StartDate: r.lease.startDate,
        EndDate: r.lease.endDate,
        RentAmount: r.lease.rentAmount,
        Status: r.lease.status
    }));

    return {
        summary: { totalLeases: reportRows.length },
        rows: reportRows,
        columns: [
            { header: "Property", key: "Property", width: 25 },
            { header: "Address", key: "Address", width: 30 },
            { header: "Start Date", key: "StartDate", width: 15 },
            { header: "End Date", key: "EndDate", width: 15 },
            { header: "Rent Amount", key: "RentAmount", width: 15 },
            { header: "Status", key: "Status", width: 18 }
        ]
    };
}

/* -------------------------------------------------------------------------- */
/* Payment history                                                             */
/* -------------------------------------------------------------------------- */

export async function getPaymentHistoryReport(requester: Requester, { from, to }: ReportDateRangeInput): Promise<ReportResult> {
    const { start, end } = resolveDateRange(from, to);

    const conditions = [gte(payments.createdAt, start), lte(payments.createdAt, end)];

    if (requester.role === "tenant") {
        conditions.push(eq(payments.tenantId, requester.id));
    } else if (requester.role === "owner") {
        conditions.push(eq(leases.ownerId, requester.id));
    }

    const rows = await db
        .select({ payment: payments })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(and(...conditions))
        .orderBy(desc(payments.createdAt));

    const reportRows = rows.map((r) => ({
        Date: format(r.payment.createdAt, "yyyy-MM-dd"),
        Amount: r.payment.amount,
        Method: r.payment.method,
        Status: r.payment.status,
        Reference: r.payment.providerReference
    }));

    const totalAmount = round2(
        rows.filter((r) => r.payment.status === "success").reduce((sum, r) => sum + Number(r.payment.amount), 0)
    );

    return {
        summary: { totalPayments: reportRows.length, totalAmount },
        rows: reportRows,
        columns: [
            { header: "Date", key: "Date", width: 15 },
            { header: "Amount", key: "Amount", width: 15 },
            { header: "Method", key: "Method", width: 18 },
            { header: "Status", key: "Status", width: 12 },
            { header: "Reference", key: "Reference", width: 30 }
        ]
    };
}

/* -------------------------------------------------------------------------- */
/* Occupancy                                                                   */
/* -------------------------------------------------------------------------- */

export async function getOccupancyReport(requester: Requester, { from, to }: ReportDateRangeInput): Promise<ReportResult> {
    const { start, end, periodFrom, periodTo } = resolveDateRange(from, to);

    const propertyConditions = [];
    if (requester.role === "owner") {
        propertyConditions.push(eq(properties.ownerId, requester.id));
    }

    const ownedProperties = await db
        .select()
        .from(properties)
        .where(propertyConditions.length > 0 ? and(...propertyConditions) : undefined);

    const periodDays = Math.max(0, differenceInCalendarDays(end, start) + 1);

    const reportRows: Record<string, unknown>[] = [];

    for (const property of ownedProperties) {
        const propertyLeases = await db
            .select()
            .from(leases)
            .where(and(eq(leases.propertyId, property.id), lte(leases.startDate, periodTo), gte(leases.endDate, periodFrom)));

        let occupiedDays = 0;
        for (const lease of propertyLeases) {
            const leaseStart = new Date(lease.startDate);
            const leaseEnd = new Date(lease.endDate);
            const clampedStart = leaseStart < start ? start : leaseStart;
            const clampedEnd = leaseEnd > end ? end : leaseEnd;
            const days = differenceInCalendarDays(clampedEnd, clampedStart) + 1;
            occupiedDays += Math.max(0, days);
        }

        occupiedDays = Math.min(occupiedDays, periodDays);
        const occupancyRatePercent = periodDays === 0 ? 0 : round2((occupiedDays / periodDays) * 100);

        reportRows.push({
            Property: property.title,
            Status: property.status,
            LeaseCount: propertyLeases.length,
            OccupiedDays: occupiedDays,
            PeriodDays: periodDays,
            OccupancyRatePercent: occupancyRatePercent
        });
    }

    const averageOccupancyRatePercent =
        reportRows.length === 0
            ? 0
            : round2(
                  reportRows.reduce((sum, r) => sum + Number(r.OccupancyRatePercent), 0) / reportRows.length
              );

    return {
        summary: { averageOccupancyRatePercent },
        rows: reportRows,
        columns: [
            { header: "Property", key: "Property", width: 25 },
            { header: "Status", key: "Status", width: 15 },
            { header: "Lease Count", key: "LeaseCount", width: 12 },
            { header: "Occupied Days", key: "OccupiedDays", width: 15 },
            { header: "Period Days", key: "PeriodDays", width: 15 },
            { header: "Occupancy Rate %", key: "OccupancyRatePercent", width: 18 }
        ]
    };
}

/* -------------------------------------------------------------------------- */
/* Maintenance activity                                                        */
/* -------------------------------------------------------------------------- */

export async function getMaintenanceActivityReport(requester: Requester, { from, to }: ReportDateRangeInput): Promise<ReportResult> {
    const { start, end } = resolveDateRange(from, to);

    const conditions = [gte(maintenanceRequests.createdAt, start), lte(maintenanceRequests.createdAt, end)];

    if (requester.role === "owner") {
        conditions.push(eq(properties.ownerId, requester.id));
    }

    const rows = await db
        .select({ request: maintenanceRequests, property: properties })
        .from(maintenanceRequests)
        .innerJoin(properties, eq(maintenanceRequests.propertyId, properties.id))
        .where(and(...conditions))
        .orderBy(maintenanceRequests.createdAt);

    const reportRows = rows.map((r) => ({
        Property: r.property.title,
        Title: r.request.title,
        Status: r.request.status,
        ItemsCost: r.request.itemsCost ?? 0,
        LaborCost: r.request.laborCost ?? 0,
        CreatedAt: format(r.request.createdAt, "yyyy-MM-dd"),
        CompletedAt: r.request.completedAt ? format(r.request.completedAt, "yyyy-MM-dd") : ""
    }));

    const byStatus = rows.reduce(
        (acc, r) => {
            acc[r.request.status] = (acc[r.request.status] ?? 0) + 1;
            return acc;
        },
        { submitted: 0, assigned: 0, in_progress: 0, completed: 0 } as Record<string, number>
    );

    const totalCost = round2(
        reportRows.reduce((sum, r) => sum + Number(r.ItemsCost) + Number(r.LaborCost), 0)
    );

    const completedRows = rows.filter((r) => r.request.status === "completed" && r.request.completedAt);
    const averageResolutionDays =
        completedRows.length === 0
            ? 0
            : round1(
                  completedRows.reduce(
                      (sum, r) => sum + differenceInCalendarDays(r.request.completedAt as Date, r.request.createdAt),
                      0
                  ) / completedRows.length
              );

    return {
        summary: {
            totalRequests: reportRows.length,
            byStatus,
            totalCost,
            averageResolutionDays
        },
        rows: reportRows,
        columns: [
            { header: "Property", key: "Property", width: 25 },
            { header: "Title", key: "Title", width: 25 },
            { header: "Status", key: "Status", width: 15 },
            { header: "Items Cost", key: "ItemsCost", width: 12 },
            { header: "Labor Cost", key: "LaborCost", width: 12 },
            { header: "Created At", key: "CreatedAt", width: 15 },
            { header: "Completed At", key: "CompletedAt", width: 15 }
        ]
    };
}

/* -------------------------------------------------------------------------- */
/* Revenue performance                                                         */
/* -------------------------------------------------------------------------- */

export async function getRevenuePerformanceReport(requester: Requester, { from, to }: ReportDateRangeInput): Promise<ReportResult> {
    const { start, end } = resolveDateRange(from, to);

    const conditions = [eq(payments.status, "success"), gte(payments.paidAt, start), lte(payments.paidAt, end)];

    if (requester.role === "owner") {
        conditions.push(eq(leases.ownerId, requester.id));
    }

    const rows = await db
        .select({ payment: payments })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(and(...conditions));

    const byMonth = new Map<string, number>();
    for (const r of rows) {
        if (!r.payment.paidAt) continue;
        const month = format(r.payment.paidAt, "yyyy-MM");
        byMonth.set(month, (byMonth.get(month) ?? 0) + Number(r.payment.amount));
    }

    const reportRows = Array.from(byMonth.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([month, amount]) => ({ Month: month, Revenue: round2(amount) }));

    const totalRevenue = round2(reportRows.reduce((sum, r) => sum + r.Revenue, 0));

    return {
        summary: { totalRevenue },
        rows: reportRows,
        columns: [
            { header: "Month", key: "Month", width: 15 },
            { header: "Revenue", key: "Revenue", width: 15 }
        ]
    };
}

/* -------------------------------------------------------------------------- */
/* Agent performance                                                           */
/* -------------------------------------------------------------------------- */

export async function getAgentPerformanceReport(_admin: Requester, _range: ReportDateRangeInput): Promise<ReportResult> {
    const agents = await db.select().from(users).where(eq(users.role, "agent"));

    const reportRows: Record<string, unknown>[] = [];

    for (const agent of agents) {
        const managedProperties = await db.select().from(properties).where(eq(properties.agentId, agent.id));

        const approvedListings = managedProperties.filter((p) => p.approvalStatus === "approved").length;
        const rejectedListings = managedProperties.filter((p) => p.approvalStatus === "rejected").length;
        const pendingListings = managedProperties.filter((p) => p.approvalStatus === "pending").length;

        const propertyIds = managedProperties.map((p) => p.id);
        let activeLeases = 0;
        if (propertyIds.length > 0) {
            const activeLeaseRows = await db
                .select()
                .from(leases)
                .where(and(inArray(leases.propertyId, propertyIds), eq(leases.status, "active")));
            activeLeases = activeLeaseRows.length;
        }

        reportRows.push({
            Agent: `${agent.firstName} ${agent.lastName}`,
            PropertiesManaged: managedProperties.length,
            ApprovedListings: approvedListings,
            RejectedListings: rejectedListings,
            PendingListings: pendingListings,
            ActiveLeases: activeLeases
        });
    }

    return {
        summary: { totalAgents: reportRows.length },
        rows: reportRows,
        columns: [
            { header: "Agent", key: "Agent", width: 25 },
            { header: "Properties Managed", key: "PropertiesManaged", width: 18 },
            { header: "Approved Listings", key: "ApprovedListings", width: 18 },
            { header: "Rejected Listings", key: "RejectedListings", width: 18 },
            { header: "Pending Listings", key: "PendingListings", width: 18 },
            { header: "Active Leases", key: "ActiveLeases", width: 15 }
        ]
    };
}
