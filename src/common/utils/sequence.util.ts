import { sql } from "drizzle-orm";
import { db } from "../../database";

export type DocumentPrefix = "ACC-INV" | "ACC-PAY";

export async function nextDocumentNumber(prefix: DocumentPrefix, date: Date = new Date()): Promise<string> {
    const year = date.getFullYear();
    const key = `${prefix}:${year}`;

    const result = await db.execute<{ last_value: number }>(sql`
        insert into document_sequences (key, last_value)
        values (${key}, 1)
        on conflict (key) do update set last_value = document_sequences.last_value + 1, updated_at = now()
        returning last_value
    `);

    const lastValue = result.rows[0]?.["last_value"];
    if (lastValue === undefined) throw new Error(`Failed to allocate a document number for ${key}`);

    return `${prefix}-${year}-${String(lastValue).padStart(5, "0")}`;
}
