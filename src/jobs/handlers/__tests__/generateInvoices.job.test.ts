import { format, getDaysInMonth, setDate, startOfMonth, subMonths } from "date-fns";
import { eq } from "drizzle-orm";
import { createAuthedUser, createLease, createProperty } from "../../../../tests/helpers/factories";
import { db } from "../../../database";
import { invoices } from "../../../database/schema";
import { generateInvoicesJob } from "../generateInvoices.job";

async function setupActiveLease(overrides: { paymentDate?: string } = {}) {
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
        rentAmount: 1500
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
});
