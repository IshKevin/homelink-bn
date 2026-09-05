import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear } from "date-fns";
import { db } from "../../database";
import {
    invites,
    invoices,
    leases,
    maintenanceRequests,
    managerAssignments,
    notifications,
    payments,
    platformSettings,
    properties,
    propertyUnits,
    suspensionRequests,
    users
} from "../../database/schema";

const DEFAULT_TAX_RATE = 0.18;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface OwnerDashboard {
    revenue: { thisMonth: number; thisYear: number };
    outstandingRent: number;
    occupancy: {
        totalProperties: number;
        occupiedProperties: number;
        vacantUnits: number;
        occupancyRatePercent: number;
        // Real property_units counts (a single multi-unit apartment building
        // is one "property" above but could be many units) — the above four
        // fields are kept as-is for backward compatibility with whatever
        // already reads them; these are the accurate per-unit numbers.
        totalUnits: number;
        occupiedUnits: number;
        availableUnits: number;
        maintenanceUnitsCount: number;
    };
    totalTenants: number;
    maintenanceExpenses: { thisMonth: number; thisYear: number };
    netProfit: { thisMonth: number; thisYear: number };
}

async function sumSuccessfulPayments(ownerId: string, from: Date, to: Date): Promise<number> {
    const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(
            and(
                eq(leases.ownerId, ownerId),
                eq(payments.status, "success"),
                gte(payments.paidAt, from),
                lte(payments.paidAt, to)
            )
        );

    return Number(row?.total ?? 0);
}

async function sumMaintenanceExpenses(ownerId: string, from: Date, to: Date): Promise<number> {
    const [row] = await db
        .select({
            total: sql<string>`coalesce(sum(coalesce(${maintenanceRequests.itemsCost}, 0) + coalesce(${maintenanceRequests.laborCost}, 0)), 0)`
        })
        .from(maintenanceRequests)
        .innerJoin(properties, eq(maintenanceRequests.propertyId, properties.id))
        .where(
            and(
                eq(properties.ownerId, ownerId),
                eq(maintenanceRequests.status, "completed"),
                gte(maintenanceRequests.completedAt, from),
                lte(maintenanceRequests.completedAt, to)
            )
        );

    return Number(row?.total ?? 0);
}

export async function getOwnerDashboard(ownerId: string): Promise<OwnerDashboard> {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const yearStart = startOfYear(now);
    const yearEnd = endOfYear(now);

    const [revenueThisMonth, revenueThisYear, maintenanceThisMonth, maintenanceThisYear] = await Promise.all([
        sumSuccessfulPayments(ownerId, monthStart, monthEnd),
        sumSuccessfulPayments(ownerId, yearStart, yearEnd),
        sumMaintenanceExpenses(ownerId, monthStart, monthEnd),
        sumMaintenanceExpenses(ownerId, yearStart, yearEnd)
    ]);

    const [outstandingRow] = await db
        .select({ total: sql<string>`coalesce(sum(${invoices.amountDue}), 0)` })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(
            and(
                eq(leases.ownerId, ownerId),
                sql`${invoices.status} in ('unpaid', 'overdue')`
            )
        );
    const outstandingRent = Number(outstandingRow?.total ?? 0);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(eq(properties.ownerId, ownerId));
    const totalProperties = totalRow?.count ?? 0;

    const [occupiedRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(and(eq(properties.ownerId, ownerId), eq(properties.status, "occupied")));
    const occupiedProperties = occupiedRow?.count ?? 0;

    const vacantUnits = totalProperties - occupiedProperties;
    const occupancyRatePercent = totalProperties === 0 ? 0 : round2((occupiedProperties / totalProperties) * 100);

    const unitCounts = await db
        .select({ status: propertyUnits.status, count: sql<number>`count(*)::int` })
        .from(propertyUnits)
        .innerJoin(properties, eq(propertyUnits.propertyId, properties.id))
        .where(eq(properties.ownerId, ownerId))
        .groupBy(propertyUnits.status);
    const unitCountByStatus = Object.fromEntries(unitCounts.map((r) => [r.status, r.count]));
    const totalUnits = unitCounts.reduce((sum, r) => sum + r.count, 0);

    const [tenantsRow] = await db
        .select({ count: sql<number>`count(distinct ${leases.tenantId})::int` })
        .from(leases)
        .where(and(eq(leases.ownerId, ownerId), sql`${leases.status} not in ('terminated', 'expired')`));
    const totalTenants = tenantsRow?.count ?? 0;

    return {
        revenue: { thisMonth: revenueThisMonth, thisYear: revenueThisYear },
        outstandingRent,
        occupancy: {
            totalProperties,
            occupiedProperties,
            vacantUnits,
            occupancyRatePercent,
            totalUnits,
            occupiedUnits: unitCountByStatus["occupied"] ?? 0,
            availableUnits: unitCountByStatus["available"] ?? 0,
            maintenanceUnitsCount: unitCountByStatus["maintenance"] ?? 0
        },
        totalTenants,
        maintenanceExpenses: { thisMonth: maintenanceThisMonth, thisYear: maintenanceThisYear },
        netProfit: {
            thisMonth: revenueThisMonth - maintenanceThisMonth,
            thisYear: revenueThisYear - maintenanceThisYear
        }
    };
}

export interface TenantDashboard {
    activeLease: {
        id: string;
        propertyTitle: string;
        addressLine: string;
        city: string;
        rentAmount: number;
        startDate: string;
        endDate: string | null;
        status: string;
    } | null;
    outstandingBalance: number;
    nextDueInvoice: { id: string; period: string; amountDue: number; dueDate: string } | null;
    paymentsThisYear: number;
    maintenanceRequests: { open: number; inProgress: number; completed: number };
    unreadNotifications: number;
}

export async function getTenantDashboard(tenantId: string): Promise<TenantDashboard> {
    const now = new Date();
    const yearStart = startOfYear(now);
    const yearEnd = endOfYear(now);

    const [activeLeaseRow] = await db
        .select({ lease: leases, property: properties })
        .from(leases)
        .innerJoin(properties, eq(leases.propertyId, properties.id))
        .where(and(eq(leases.tenantId, tenantId), eq(leases.status, "active")))
        .orderBy(desc(leases.createdAt))
        .limit(1);

    const activeLease = activeLeaseRow
        ? {
              id: activeLeaseRow.lease.id,
              propertyTitle: activeLeaseRow.property.title,
              addressLine: activeLeaseRow.property.addressLine,
              city: activeLeaseRow.property.city,
              rentAmount: Number(activeLeaseRow.lease.rentAmount),
              startDate: activeLeaseRow.lease.startDate,
              endDate: activeLeaseRow.lease.endDate,
              status: activeLeaseRow.lease.status
          }
        : null;

    const [outstandingRow] = await db
        .select({ total: sql<string>`coalesce(sum(${invoices.amountDue}), 0)` })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(and(eq(leases.tenantId, tenantId), sql`${invoices.status} in ('unpaid', 'overdue')`));
    const outstandingBalance = Number(outstandingRow?.total ?? 0);

    const [nextDueInvoiceRow] = await db
        .select({ invoice: invoices })
        .from(invoices)
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(and(eq(leases.tenantId, tenantId), sql`${invoices.status} in ('unpaid', 'overdue')`))
        .orderBy(invoices.dueDate)
        .limit(1);
    const nextDueInvoice = nextDueInvoiceRow
        ? {
              id: nextDueInvoiceRow.invoice.id,
              period: nextDueInvoiceRow.invoice.period,
              amountDue: Number(nextDueInvoiceRow.invoice.amountDue),
              dueDate: nextDueInvoiceRow.invoice.dueDate
          }
        : null;

    const [paymentsThisYearRow] = await db
        .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .where(
            and(
                eq(payments.tenantId, tenantId),
                eq(payments.status, "success"),
                gte(payments.paidAt, yearStart),
                lte(payments.paidAt, yearEnd)
            )
        );
    const paymentsThisYear = Number(paymentsThisYearRow?.total ?? 0);

    async function countMaintenanceByStatus(statuses: Array<typeof maintenanceRequests.$inferSelect.status>) {
        const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(maintenanceRequests)
            .where(and(eq(maintenanceRequests.tenantId, tenantId), inArray(maintenanceRequests.status, statuses)));
        return row?.count ?? 0;
    }

    const [openCount, inProgressCount, completedCount] = await Promise.all([
        countMaintenanceByStatus(["submitted", "assigned"]),
        countMaintenanceByStatus(["in_progress"]),
        countMaintenanceByStatus(["completed"])
    ]);

    const [unreadRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, tenantId), eq(notifications.isRead, false)));
    const unreadNotifications = unreadRow?.count ?? 0;

    return {
        activeLease,
        outstandingBalance,
        nextDueInvoice,
        paymentsThisYear,
        maintenanceRequests: { open: openCount, inProgress: inProgressCount, completed: completedCount },
        unreadNotifications
    };
}

export interface AgentDashboard {
    properties: { total: number; available: number; occupied: number; pendingApproval: number };
    activeLeases: number;
    maintenanceRequests: { assignedToMe: number; openAcrossManagedProperties: number };
    unreadNotifications: number;
}

export async function getAgentDashboard(agentId: string): Promise<AgentDashboard> {
    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(eq(properties.agentId, agentId));
    const total = totalRow?.count ?? 0;

    const [availableRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(and(eq(properties.agentId, agentId), eq(properties.status, "available")));
    const available = availableRow?.count ?? 0;

    const [occupiedRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(and(eq(properties.agentId, agentId), eq(properties.status, "occupied")));
    const occupied = occupiedRow?.count ?? 0;

    const [pendingApprovalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(and(eq(properties.agentId, agentId), eq(properties.approvalStatus, "pending")));
    const pendingApproval = pendingApprovalRow?.count ?? 0;

    const [activeLeasesRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leases)
        .innerJoin(properties, eq(leases.propertyId, properties.id))
        .where(and(eq(properties.agentId, agentId), eq(leases.status, "active")));
    const activeLeases = activeLeasesRow?.count ?? 0;

    const [assignedToMeRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(maintenanceRequests)
        .where(
            and(eq(maintenanceRequests.assignedTo, agentId), inArray(maintenanceRequests.status, ["assigned", "in_progress"]))
        );
    const assignedToMe = assignedToMeRow?.count ?? 0;

    const [openAcrossManagedRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(maintenanceRequests)
        .innerJoin(properties, eq(maintenanceRequests.propertyId, properties.id))
        .where(
            and(
                eq(properties.agentId, agentId),
                inArray(maintenanceRequests.status, ["submitted", "assigned", "in_progress"])
            )
        );
    const openAcrossManagedProperties = openAcrossManagedRow?.count ?? 0;

    const [unreadRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, agentId), eq(notifications.isRead, false)));
    const unreadNotifications = unreadRow?.count ?? 0;

    return {
        properties: { total, available, occupied, pendingApproval },
        activeLeases,
        maintenanceRequests: { assignedToMe, openAcrossManagedProperties },
        unreadNotifications
    };
}

export interface AdminDashboard {
    totalPlatformRevenue: number;
    activeUsers: number;
    usersByRole: {
        tenant: number;
        owner: number;
        agent: number;
        admin: number;
        superadmin: number;
        house_manager: number;
    };
    properties: { total: number; newThisMonth: number };
    payments: { total: number; successCount: number; failedCount: number; successRatePercent: number };
    iam: { activeManagers: number; pendingInvites: number; pendingSuspensionRequests: number };
}

async function countUsersByRole(
    role: "tenant" | "owner" | "agent" | "admin" | "superadmin" | "house_manager"
): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.role, role));
    return row?.count ?? 0;
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [revenueRow] = await db
        .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .where(eq(payments.status, "success"));
    const totalPlatformRevenue = Number(revenueRow?.total ?? 0);

    const [activeUsersRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.isActive, true));
    const activeUsers = activeUsersRow?.count ?? 0;

    const [tenantCount, ownerCount, agentCount, adminCount, superadminCount, houseManagerCount] = await Promise.all([
        countUsersByRole("tenant"),
        countUsersByRole("owner"),
        countUsersByRole("agent"),
        countUsersByRole("admin"),
        countUsersByRole("superadmin"),
        countUsersByRole("house_manager")
    ]);

    const [totalPropertiesRow] = await db.select({ count: sql<number>`count(*)::int` }).from(properties);
    const totalProperties = totalPropertiesRow?.count ?? 0;

    const [newPropertiesRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(and(gte(properties.createdAt, monthStart), lte(properties.createdAt, monthEnd)));
    const newThisMonth = newPropertiesRow?.count ?? 0;

    const [totalPaymentsRow] = await db.select({ count: sql<number>`count(*)::int` }).from(payments);
    const totalPayments = totalPaymentsRow?.count ?? 0;

    const [successPaymentsRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(eq(payments.status, "success"));
    const successCount = successPaymentsRow?.count ?? 0;

    const [failedPaymentsRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(eq(payments.status, "failed"));
    const failedCount = failedPaymentsRow?.count ?? 0;

    const successRatePercent = totalPayments === 0 ? 0 : round2((successCount / totalPayments) * 100);

    const [activeManagersRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(managerAssignments)
        .where(eq(managerAssignments.status, "active"));
    const activeManagers = activeManagersRow?.count ?? 0;

    const [pendingInvitesRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invites)
        .where(eq(invites.status, "pending"));
    const pendingInvites = pendingInvitesRow?.count ?? 0;

    const [pendingSuspensionRequestsRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(suspensionRequests)
        .where(eq(suspensionRequests.status, "pending"));
    const pendingSuspensionRequests = pendingSuspensionRequestsRow?.count ?? 0;

    return {
        totalPlatformRevenue,
        activeUsers,
        usersByRole: {
            tenant: tenantCount,
            owner: ownerCount,
            agent: agentCount,
            admin: adminCount,
            superadmin: superadminCount,
            house_manager: houseManagerCount
        },
        properties: { total: totalProperties, newThisMonth },
        payments: { total: totalPayments, successCount, failedCount, successRatePercent },
        iam: { activeManagers, pendingInvites, pendingSuspensionRequests }
    };
}

export interface ProfitLossStatement {
    periodFrom: string;
    periodTo: string;
    revenue: number;
    expenses: number;
    grossProfit: number;
    taxRate: number;
    taxAmount: number;
    netProfit: number;
}

/**
 * Computes a platform-wide profit & loss statement for the given period.
 * The tax rate is read from `platformSettings` (key: "taxRate") and defaults
 * to a mocked/configurable 18% (0.18) placeholder when no setting is stored.
 */
export async function getProfitLossStatement(from?: string, to?: string): Promise<ProfitLossStatement> {
    const now = new Date();
    const rangeStart = from ? new Date(from) : startOfYear(now);
    const rangeEnd = to ? new Date(`${to}T23:59:59`) : endOfYear(now);

    const periodFrom = format(rangeStart, "yyyy-MM-dd");
    const periodTo = format(rangeEnd, "yyyy-MM-dd");

    const [revenueRow] = await db
        .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .where(and(eq(payments.status, "success"), gte(payments.paidAt, rangeStart), lte(payments.paidAt, rangeEnd)));
    const revenue = Number(revenueRow?.total ?? 0);

    const [expensesRow] = await db
        .select({
            total: sql<string>`coalesce(sum(coalesce(${maintenanceRequests.itemsCost}, 0) + coalesce(${maintenanceRequests.laborCost}, 0)), 0)`
        })
        .from(maintenanceRequests)
        .where(
            and(
                eq(maintenanceRequests.status, "completed"),
                gte(maintenanceRequests.completedAt, rangeStart),
                lte(maintenanceRequests.completedAt, rangeEnd)
            )
        );
    const expenses = Number(expensesRow?.total ?? 0);

    const grossProfit = revenue - expenses;

    const [taxSetting] = await db.select().from(platformSettings).where(eq(platformSettings.key, "taxRate")).limit(1);
    const taxRate = taxSetting ? Number(taxSetting.value) : DEFAULT_TAX_RATE;

    const taxAmount = Math.max(0, grossProfit) * taxRate;
    const netProfit = grossProfit - taxAmount;

    return {
        periodFrom,
        periodTo,
        revenue: round2(revenue),
        expenses: round2(expenses),
        grossProfit: round2(grossProfit),
        taxRate: round2(taxRate),
        taxAmount: round2(taxAmount),
        netProfit: round2(netProfit)
    };
}

export function buildStatementRows(statement: ProfitLossStatement): Record<string, unknown>[] {
    return [
        { Metric: "Revenue", Value: statement.revenue },
        { Metric: "Expenses", Value: statement.expenses },
        { Metric: "Gross Profit", Value: statement.grossProfit },
        { Metric: "Tax Rate", Value: `${round2(statement.taxRate * 100).toFixed(2)}%` },
        { Metric: "Tax Amount", Value: statement.taxAmount },
        { Metric: "Net Profit", Value: statement.netProfit }
    ];
}

export function buildStatementHtml(statement: ProfitLossStatement): string {
    return `
        <html>
            <head>
                <meta charset="utf-8" />
                <title>Profit & Loss Statement</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 24px; }
                    h1 { font-size: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                    td { padding: 8px; border-bottom: 1px solid #ddd; }
                    td:first-child { font-weight: bold; width: 200px; }
                </style>
            </head>
            <body>
                <h1>Profit & Loss Statement</h1>
                <table>
                    <tr><td>Period</td><td>${statement.periodFrom} to ${statement.periodTo}</td></tr>
                    <tr><td>Revenue</td><td>${statement.revenue}</td></tr>
                    <tr><td>Expenses</td><td>${statement.expenses}</td></tr>
                    <tr><td>Gross Profit</td><td>${statement.grossProfit}</td></tr>
                    <tr><td>Tax Rate</td><td>${round2(statement.taxRate * 100).toFixed(2)}%</td></tr>
                    <tr><td>Tax Amount</td><td>${statement.taxAmount}</td></tr>
                    <tr><td>Net Profit</td><td>${statement.netProfit}</td></tr>
                </table>
            </body>
        </html>
    `;
}
