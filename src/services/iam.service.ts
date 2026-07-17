import { and, eq } from "drizzle-orm";
import { db } from "../database";
import { managerAssignments } from "../database/schema";
import { AppError } from "../common/errors/AppError";

export type EffectiveOwnerUser = { id: string; role: Express.AuthUser["role"] };

/**
 * A house_manager acts on behalf of exactly one house owner (their active
 * assignment). Every other role maps to itself for ownership comparisons.
 */
export async function resolveEffectiveOwnerId(user: EffectiveOwnerUser): Promise<string> {
    if (user.role !== "house_manager") return user.id;

    const [assignment] = await db
        .select()
        .from(managerAssignments)
        .where(and(eq(managerAssignments.managerId, user.id), eq(managerAssignments.status, "active")))
        .limit(1);

    if (!assignment) {
        throw AppError.forbidden("You do not have an active manager assignment");
    }

    return assignment.ownerId;
}

export function isAdminRole(role: Express.AuthUser["role"]): boolean {
    return role === "admin" || role === "superadmin";
}
