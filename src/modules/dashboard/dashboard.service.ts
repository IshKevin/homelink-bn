import { and, eq, gte, lte, sql } from "drizzle-orm";
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear } from "date-fns";
import { db } from "../../database";
import { invoices, leases, maintenanceRequests, payments, platformSettings, properties, users } from "../../database/schema";

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
    };
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

    return {
        revenue: { thisMonth: revenueThisMonth, thisYear: revenueThisYear },
        outstandingRent,
        occupancy: {
            totalProperties,
            occupiedProperties,
            vacantUnits,
            occupancyRatePercent
        },
        maintenanceExpenses: { thisMonth: maintenanceThisMonth, thisYear: maintenanceThisYear },
        netProfit: {
            thisMonth: revenueThisMonth - maintenanceThisMonth,
            thisYear: revenueThisYear - maintenanceThisYear
        }
    };
}

export interface AdminDashboard {
    totalPlatformRevenue: number;
    activeUsers: number;
    usersByRole: { tenant: number; owner: number; agent: number; admin: number };
    properties: { total: number; newThisMonth: number };
    payments: { total: number; successCount: number; failedCount: number; successRatePercent: number };
}

async function countUsersByRole(role: "tenant" | "owner" | "agent" | "admin"): Promise<number> {
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

    const [tenantCount, ownerCount, agentCount, adminCount] = await Promise.all([
        countUsersByRole("tenant"),
        countUsersByRole("owner"),
        countUsersByRole("agent"),
        countUsersByRole("admin")
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

    return {
        totalPlatformRevenue,
        activeUsers,
        usersByRole: { tenant: tenantCount, owner: ownerCount, agent: agentCount, admin: adminCount },
        properties: { total: totalProperties, newThisMonth },
        payments: { total: totalPayments, successCount, failedCount, successRatePercent }
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
