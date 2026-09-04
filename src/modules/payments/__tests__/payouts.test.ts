import { eq } from "drizzle-orm";
import { createAuthedUser, createInvoice, createLease, createProperty } from "../../../../tests/helpers/factories";
import { testRequest } from "../../../../tests/helpers/app";
import { db } from "../../../database";
import { notifications, payments, payouts, users } from "../../../database/schema";
import { nextDocumentNumber } from "../../../common/utils/sequence.util";
import { initiateDisbursement, markPayoutFailed, markPayoutSuccess, releaseHeldPayouts } from "../payouts.service";
import * as mtnMomoClient from "../../../services/payments/mtnMomo/client";

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

async function setupLease() {
    const { user: owner } = await createAuthedUser({ role: "owner" });
    const { user: tenant } = await createAuthedUser({ role: "tenant" });
    const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
    const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
    const invoice = await createInvoice({ leaseId: lease.id, amountDue: "1000.00" });
    return { owner, tenant, property, lease, invoice };
}

// initiateDisbursement's payout row has a real FK to payments.id, so the
// event detail needs a genuine payment row behind it, not just a random id.
async function detailFor(lease: { id: string; ownerId: string; tenantId: string }, invoiceId: string, amount = "1000.00") {
    const paymentNumber = await nextDocumentNumber("ACC-PAY");
    const [payment] = await db
        .insert(payments)
        .values({
            paymentNumber,
            invoiceId,
            tenantId: lease.tenantId,
            amount,
            method: "mobile_money",
            provider: "MTN Mobile Money",
            providerReference: `TEST-${paymentNumber}`,
            status: "success",
            paidAt: new Date()
        })
        .returning();

    return {
        paymentId: payment!.id,
        invoiceId,
        leaseId: lease.id,
        ownerId: lease.ownerId,
        tenantId: lease.tenantId,
        amount
    };
}

describe("Payouts (automated landlord disbursement)", () => {
    // MTN credentials are unset in the test env, so isMtnMomoConfigured("disbursement")
    // is false by default — these tests exercise the mock-disbursement path unless a
    // test explicitly mocks the mtnMomo client to simulate real credentials.

    it("disburses (mock) immediately when MTN disbursement isn't configured, and notifies the owner", async () => {
        const { owner, lease, invoice } = await setupLease();
        const detail = await detailFor(lease, invoice.id);

        await initiateDisbursement(detail);

        const [payout] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
        expect(payout).toBeDefined();
        expect(payout!.status).toBe("success");
        expect(payout!.provider).toBe("MTN MoMo (mock)");
        expect(payout!.disbursedAt).not.toBeNull();

        const ownerNotifications = await db.select().from(notifications).where(eq(notifications.userId, owner.id));
        expect(ownerNotifications.some((n) => n.type === "payout.success")).toBe(true);
    });

    it("is idempotent — a second call for the same paymentId does not create a second payout", async () => {
        const { lease, invoice } = await setupLease();
        const detail = await detailFor(lease, invoice.id);

        await initiateDisbursement(detail);
        await initiateDisbursement(detail);

        const rows = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId));
        expect(rows).toHaveLength(1);
    });

    it("holds the payout instead of sending it when the landlord's account is deactivated, and notifies admins", async () => {
        const { owner, lease, invoice } = await setupLease();
        const { user: admin } = await createAuthedUser({ role: "admin" });
        await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));

        const detail = await detailFor(lease, invoice.id);
        await initiateDisbursement(detail);

        const [payout] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
        expect(payout!.status).toBe("held");
        expect(payout!.failureReason).toMatch(/deactivated/i);

        const adminNotifications = await db.select().from(notifications).where(eq(notifications.userId, admin.id));
        expect(adminNotifications.some((n) => n.type === "payout.held")).toBe(true);
    });

    it("automatically releases a held payout once the landlord's account is reactivated", async () => {
        const { owner, lease, invoice } = await setupLease();
        await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));

        const detail = await detailFor(lease, invoice.id);
        await initiateDisbursement(detail);
        const [held] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
        expect(held!.status).toBe("held");

        await db.update(users).set({ isActive: true }).where(eq(users.id, owner.id));
        await releaseHeldPayouts(owner.id);

        const [released] = await db.select().from(payouts).where(eq(payouts.id, held!.id)).limit(1);
        expect(released!.status).toBe("success");
        expect(released!.provider).toBe("MTN MoMo (mock)");
    });

    it("reactivating a landlord's account via the admin API releases their held payouts end-to-end", async () => {
        const { owner, lease, invoice } = await setupLease();
        const { accessToken: adminToken } = await createAuthedUser({ role: "admin" });
        await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));

        const detail = await detailFor(lease, invoice.id);
        await initiateDisbursement(detail);

        const res = await testRequest()
            .patch(`/api/v1/admin/users/${owner.id}/status`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ isActive: true });
        expect(res.status).toBe(200);

        const [payout] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
        expect(payout!.status).toBe("success");
    });

    describe("with real MTN disbursement credentials configured", () => {
        afterEach(() => jest.restoreAllMocks());

        it("fails the payout when the landlord has no payoutMomoNumber on file", async () => {
            jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockImplementation((product) => product === "disbursement");
            const { lease, invoice } = await setupLease();
            const detail = await detailFor(lease, invoice.id);

            await initiateDisbursement(detail);

            const [payout] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
            expect(payout!.status).toBe("failed");
            expect(payout!.failureReason).toMatch(/no payout mobile money number/i);
        });

        it("calls MTN's transfer API and leaves the payout pending on success", async () => {
            jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockImplementation((product) => product === "disbursement");
            const transferSpy = jest.spyOn(mtnMomoClient, "transfer").mockResolvedValue(undefined);
            const { owner, lease, invoice } = await setupLease();
            await db.update(users).set({ payoutMomoNumber: "0780000099" }).where(eq(users.id, owner.id));

            const detail = await detailFor(lease, invoice.id);
            await initiateDisbursement(detail);

            expect(transferSpy).toHaveBeenCalledWith(
                expect.objectContaining({ payeePhone: "0780000099", amount: "1000.00" })
            );
            const [payout] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
            expect(payout!.status).toBe("pending");
            expect(payout!.provider).toBe("MTN MoMo");
        });

        it("marks the payout failed if the MTN transfer call itself throws", async () => {
            jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockImplementation((product) => product === "disbursement");
            jest.spyOn(mtnMomoClient, "transfer").mockRejectedValue(new Error("network error"));
            const { owner, lease, invoice } = await setupLease();
            await db.update(users).set({ payoutMomoNumber: "0780000099" }).where(eq(users.id, owner.id));

            const detail = await detailFor(lease, invoice.id);
            await initiateDisbursement(detail);

            const [payout] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
            expect(payout!.status).toBe("failed");
            expect(payout!.failureReason).toBe("Could not reach MTN MoMo");
        });
    });

    describe("markPayoutSuccess / markPayoutFailed", () => {
        it("only transitions a pending payout, ignoring an already-resolved one", async () => {
            jest.spyOn(mtnMomoClient, "isMtnMomoConfigured").mockImplementation((product) => product === "disbursement");
            jest.spyOn(mtnMomoClient, "transfer").mockResolvedValue(undefined);
            const { owner, lease, invoice } = await setupLease();
            await db.update(users).set({ payoutMomoNumber: "0780000099" }).where(eq(users.id, owner.id));

            const detail = await detailFor(lease, invoice.id);
            await initiateDisbursement(detail);
            const [pending] = await db.select().from(payouts).where(eq(payouts.paymentId, detail.paymentId)).limit(1);
            expect(pending!.status).toBe("pending");

            await markPayoutSuccess(pending!.providerReference);
            const [succeeded] = await db.select().from(payouts).where(eq(payouts.id, pending!.id)).limit(1);
            expect(succeeded!.status).toBe("success");

            // Already resolved — a second callback (retry/race) must not flip it back.
            await markPayoutFailed(pending!.providerReference, "late duplicate callback");
            const [afterDuplicate] = await db.select().from(payouts).where(eq(payouts.id, pending!.id)).limit(1);
            expect(afterDuplicate!.status).toBe("success");

            jest.restoreAllMocks();
        });
    });
});
