import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import { leads } from "../../database/schema";
import { AppError } from "../../common/errors/AppError";
import { env } from "../../config/env";
import { sendMail } from "../../services/email.service";
import { leadNotificationTemplate } from "../../services/email.templates";
import { recordAction } from "../../services/audit.service";

type LeadRow = typeof leads.$inferSelect;

export interface SubmitContactInput {
    fullName: string;
    email: string;
    subject: string;
    message: string;
}

export interface SubmitGetStartedInput {
    fullName: string;
    email: string;
    phone: string;
    roleInterest?: "owner" | "house_manager" | "tenant" | undefined;
    propertyCount?: number | undefined;
    message?: string | undefined;
}

export interface ListLeadsFilters {
    type?: LeadRow["type"] | undefined;
    status?: LeadRow["status"] | undefined;
}

async function notifyAdmin(lead: LeadRow): Promise<void> {
    if (!env.adminEmail) return;

    const details =
        lead.type === "contact"
            ? `Subject: ${lead.subject}<br />Message: ${lead.message}`
            : `Phone: ${lead.phone}<br />Interested as: ${lead.roleInterest ?? "unspecified"}` +
              (lead.propertyCount ? `<br />Number of properties: ${lead.propertyCount}` : "") +
              (lead.message ? `<br />Notes: ${lead.message}` : "");

    await sendMail({
        to: env.adminEmail,
        subject: lead.type === "contact" ? "New contact message" : "New Get Started request",
        html: leadNotificationTemplate(lead.type, lead.fullName, lead.email, details)
    });
}

export async function submitContact(input: SubmitContactInput): Promise<LeadRow> {
    const [lead] = await db
        .insert(leads)
        .values({
            type: "contact",
            fullName: input.fullName,
            email: input.email,
            subject: input.subject,
            message: input.message
        })
        .returning();

    if (!lead) throw AppError.internal("Failed to submit contact message");

    await recordAction({ action: "lead.contact.create", entity: "lead", entityId: lead.id });
    await notifyAdmin(lead);

    return lead;
}

export async function submitGetStarted(input: SubmitGetStartedInput): Promise<LeadRow> {
    const [lead] = await db
        .insert(leads)
        .values({
            type: "get_started",
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            roleInterest: input.roleInterest,
            propertyCount: input.propertyCount,
            message: input.message
        })
        .returning();

    if (!lead) throw AppError.internal("Failed to submit get started request");

    await recordAction({ action: "lead.get_started.create", entity: "lead", entityId: lead.id });
    await notifyAdmin(lead);

    return lead;
}

export async function listLeads(
    filters: ListLeadsFilters,
    pagination: { limit: number; offset: number }
): Promise<{ rows: LeadRow[]; total: number }> {
    const conditions = [];
    if (filters.type) conditions.push(eq(leads.type, filters.type));
    if (filters.status) conditions.push(eq(leads.status, filters.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(where);

    const rows = await db
        .select()
        .from(leads)
        .where(where)
        .orderBy(desc(leads.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);

    return { rows, total: countRow?.count ?? 0 };
}

export async function updateLeadStatus(leadId: string, status: LeadRow["status"]): Promise<LeadRow> {
    const [updated] = await db.update(leads).set({ status }).where(eq(leads.id, leadId)).returning();
    if (!updated) throw AppError.notFound("Lead not found");

    await recordAction({ action: "lead.status.update", entity: "lead", entityId: leadId, metadata: { status } });

    return updated;
}
