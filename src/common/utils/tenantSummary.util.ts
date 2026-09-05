import { inArray } from "drizzle-orm";
import { db } from "../../database";
import { users } from "../../database/schema";

export interface TenantSummary {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
}

// Leases/invoices/payments only ever stored a bare tenantId, forcing every
// list view in the frontend to show a placeholder like "Tenant A1B2C3D4"
// instead of a real name — this batches the lookup (one query regardless of
// row count) so callers can attach a `tenant` summary to each row.
export async function getTenantSummaries(tenantIds: string[]): Promise<Map<string, TenantSummary>> {
    const uniqueIds = [...new Set(tenantIds)];
    if (uniqueIds.length === 0) return new Map();

    const rows = await db
        .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone
        })
        .from(users)
        .where(inArray(users.id, uniqueIds));

    return new Map(rows.map((row) => [row.id, row]));
}

export async function getTenantSummary(tenantId: string): Promise<TenantSummary | undefined> {
    const summaries = await getTenantSummaries([tenantId]);
    return summaries.get(tenantId);
}
