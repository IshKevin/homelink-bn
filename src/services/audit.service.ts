import { db } from "../database";
import { auditLogs } from "../database/schema";

export interface RecordActionInput {
    userId?: string | undefined;
    action: string;
    entity: string;
    entityId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}

export async function recordAction(input: RecordActionInput): Promise<void> {
    await db.insert(auditLogs).values({
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata
    });
}
