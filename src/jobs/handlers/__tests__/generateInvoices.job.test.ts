import { format, getDaysInMonth, setDate, startOfMonth, subMonths } from "date-fns";
import { eq } from "drizzle-orm";
import { createAuthedUser, createLease, createProperty } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { invoices } from "../../../database/schema";
import { ensureInvoiceForLease, generateInvoicesJob } from "../generateInvoices.job";

async function setupActiveLease(overrides: { paymentDate?: string; deposit?: number } = {}) {
    const { user: owner } = await createAuthedUser({ role: "owner" });
    const { user: tenant } = await createAuthedUser({ role: "tenant" });
    const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
    const startDate = format(subMonths(new Date(), 2), "yyyy-MM-dd");
    const lease = await createLease({
        propertyId: property.id,
        tenantId: tenant.id,
        ownerId: owner.id,
        status: "active",
        startDate,
        paymentDate: overrides.paymentDate,
        rentAmount: 1500,
        deposit: overrides.deposit
    });
    return lease;
}

describe("generateInvoicesJob", () => {
    it("uses the lease's paymentDate day-of-month for the invoice dueDate", async () => {
        const today = new Date();
        const lease = await setupActiveLease({ paymentDate: "2020-01-15" });

        await generateInvoicesJob();

        const [invoice] = await db.select().from(invoices).where(eq(invoices.leaseId, lease.id)).limit(1);
        expect(invoice).toBeDefined();

        const expectedDay = Math.min(15, getDaysInMonth(today));
        const expectedDueDate = format(setDate(today, expectedDay), "yyyy-MM-dd");
        expect(invoice!.dueDate).toBe(expectedDueDate);
    });

    it("falls back to the start of the month when the lease has no paymentDate", async () => {
        const today = new Date();
        const lease = await setupActiveLease();

        await generateInvoicesJob();

        const [invoice] = await db.select().from(invoices).where(eq(invoices.leaseId, lease.id)).limit(1);
        expect(invoice).toBeDefined();
        expect(invoice!.dueDate).toBe(format(startOfMonth(today), "yyyy-MM-dd"));
    });

    it("folds the deposit into the first invoice only, leaving later invoices as rent alone", async () => {
        const lease = await setupActiveLease({ deposit: 400 });

        const createdFirst = await ensureInvoiceForLease(lease, new Date());
        expect(createdFirst).toBe(true);

        const [firstInvoice] = await db.select().from(invoices).where(eq(invoices.leaseId, lease.id)).limit(1);
        expect(Number(firstInvoice!.amountDue)).toBe(1900); // 1500 rent + 400 deposit

        const nextMonth = new Date(new Date().setMonth(new Date().getMonth() + 1));
        const createdSecond = await ensureInvoiceForLease(lease, nextMonth);
        expect(createdSecond).toBe(true);

        const secondInvoice = await db
            .select()
            .from(invoices)
            .where(eq(invoices.leaseId, lease.id))
            .then((rows) => rows.find((r) => r.id !== firstInvoice!.id));
        expect(Number(secondInvoice!.amountDue)).toBe(1500); // rent only — deposit already charged once
    });

    it("does not add a deposit when none was agreed", async () => {
        const lease = await setupActiveLease();

        await ensureInvoiceForLease(lease, new Date());

        const [invoice] = await db.select().from(invoices).where(eq(invoices.leaseId, lease.id)).limit(1);
        expect(Number(invoice!.amountDue)).toBe(1500);
    });
});
