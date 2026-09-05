import { testRequest } from "../../../../tests/helpers/app";
import { createAuthedUser, createInvoice, createLease, createProperty } from "../../../../tests/helpers/factories";

jest.mock("../../../services/pdf.service", () => ({
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from("pdf"))
}));

jest.mock("../../../services/storage.service", () => ({
    buildObjectKey: jest.fn().mockReturnValue("receipts/mock-key.pdf"),
    uploadBuffer: jest.fn().mockResolvedValue("receipts/mock-key.pdf"),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://example.com/signed"),
    deleteObject: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../../../services/email.service", () => ({
    sendMail: jest.fn().mockResolvedValue(undefined)
}));

async function setupLeaseWithInvoice(overrides: { amountDue?: string; invoiceStatus?: "unpaid" | "paid" | "overdue" } = {}) {
    const { user: owner, accessToken: ownerToken } = await createAuthedUser({ role: "owner" });
    const property = await createProperty({ ownerId: owner.id, status: "occupied", approvalStatus: "approved" });
    const { user: tenant, accessToken: tenantToken } = await createAuthedUser({ role: "tenant" });
    const lease = await createLease({ propertyId: property.id, tenantId: tenant.id, ownerId: owner.id, status: "active" });
    const invoice = await createInvoice({
        leaseId: lease.id,
        amountDue: overrides.amountDue ?? "1500.00",
        status: overrides.invoiceStatus ?? "unpaid"
    });
    return { owner, ownerToken, property, tenant, tenantToken, lease, invoice };
}

describe("Payments module", () => {
    describe("GET /api/v1/invoices", () => {
        it("allows a tenant to list their own invoices, hidden from an unrelated tenant", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice();
            expect(invoice.invoiceNumber).toMatch(/^ACC-INV-\d{4}-\d{5}$/);

            const res = await testRequest().get("/api/v1/invoices").set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.some((i: { id: string }) => i.id === invoice.id)).toBe(true);
            expect(res.body.data.find((i: { id: string }) => i.id === invoice.id).invoiceNumber).toBe(
                invoice.invoiceNumber
            );

            const { accessToken: otherTenantToken } = await createAuthedUser({ role: "tenant" });
            const otherRes = await testRequest().get("/api/v1/invoices").set("Authorization", `Bearer ${otherTenantToken}`);
            expect(otherRes.status).toBe(200);
            expect(otherRes.body.data.some((i: { id: string }) => i.id === invoice.id)).toBe(false);
        });

        it("allows an owner to list invoices for their properties' leases", async () => {
            const { ownerToken, invoice } = await setupLeaseWithInvoice();

            const res = await testRequest().get("/api/v1/invoices").set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.some((i: { id: string }) => i.id === invoice.id)).toBe(true);
        });

        it("embeds a tenant summary on each invoice, list and single", async () => {
            const { ownerToken, tenant, invoice } = await setupLeaseWithInvoice();

            const listRes = await testRequest().get("/api/v1/invoices").set("Authorization", `Bearer ${ownerToken}`);
            const found = listRes.body.data.find((i: { id: string }) => i.id === invoice.id);
            expect(found.tenant).toMatchObject({ id: tenant.id, email: tenant.email });

            const singleRes = await testRequest()
                .get(`/api/v1/invoices/${invoice.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(singleRes.body.data.tenant).toMatchObject({ id: tenant.id, email: tenant.email });
        });
    });

    describe("POST /api/v1/invoices/:id/pay", () => {
        it("succeeds for a normal amount, marks the invoice paid, and returns a receiptUrl", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            const res = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money", payerPhone: "0788000000" });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("success");
            expect(res.body.data.receiptUrl).toBeTruthy();
            expect(res.body.data.paymentNumber).toMatch(/^ACC-PAY-\d{4}-\d{5}$/);

            const invoiceRes = await testRequest()
                .get(`/api/v1/invoices/${invoice.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(invoiceRes.body.data.status).toBe("paid");
        });

        it("records the Airtel Money provider when carrier is 'airtel'", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            const res = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money", carrier: "airtel", payerPhone: "0788000000" });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("success");
            expect(res.body.data.provider).toBe("Airtel Money");
        });

        it("defaults to the MTN Mobile Money provider when no carrier is given", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            const res = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money", payerPhone: "0788000000" });

            expect(res.status).toBe(201);
            expect(res.body.data.provider).toBe("MTN Mobile Money");
        });

        it("fails deterministically when amountDue is 1, leaving the invoice unpaid", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1" });

            const res = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });

            expect(res.status).toBe(201);
            expect(res.body.data.status).toBe("failed");

            const invoiceRes = await testRequest()
                .get(`/api/v1/invoices/${invoice.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(invoiceRes.body.data.status).toBe("unpaid");
        });

        it("rejects paying an already-paid invoice with 409", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ invoiceStatus: "paid" });

            const res = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });

            expect(res.status).toBe(409);
        });

        it("forbids a tenant who is not on the lease from paying the invoice", async () => {
            const { invoice } = await setupLeaseWithInvoice();
            const { accessToken: otherTenantToken } = await createAuthedUser({ role: "tenant" });

            const res = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${otherTenantToken}`)
                .send({ method: "mobile_money" });

            expect(res.status).toBe(403);
        });
    });

    describe("GET /api/v1/payments", () => {
        it("allows a tenant to list their own payment history", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });

            const res = await testRequest().get("/api/v1/payments").set("Authorization", `Bearer ${tenantToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.some((p: { invoiceId: string }) => p.invoiceId === invoice.id)).toBe(true);
        });

        it("embeds a tenant summary on each payment instead of a bare tenantId", async () => {
            const { ownerToken, tenant, tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });

            const res = await testRequest().get("/api/v1/payments").set("Authorization", `Bearer ${ownerToken}`);
            const found = res.body.data.find((p: { invoiceId: string }) => p.invoiceId === invoice.id);
            expect(found.tenant).toMatchObject({ id: tenant.id, email: tenant.email });
        });

        it("supports filtering by unitId, tenantId, and propertyId — for the unit/tenant/property payment history views", async () => {
            const { ownerToken, tenant, tenantToken, lease, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });
            // An unrelated lease/payment on a different unit/property/tenant, to prove each filter actually excludes it.
            const { tenantToken: otherTenantToken, invoice: otherInvoice } = await setupLeaseWithInvoice({ amountDue: "1000.00" });

            await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });
            await testRequest()
                .post(`/api/v1/invoices/${otherInvoice.id}/pay`)
                .set("Authorization", `Bearer ${otherTenantToken}`)
                .send({ method: "mobile_money" });

            const byUnit = await testRequest()
                .get(`/api/v1/payments?unitId=${lease.unitId}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(byUnit.status).toBe(200);
            expect(byUnit.body.data.length).toBeGreaterThan(0);
            expect(byUnit.body.data.every((p: { invoiceId: string }) => p.invoiceId === invoice.id)).toBe(true);

            const byTenant = await testRequest()
                .get(`/api/v1/payments?tenantId=${tenant.id}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(byTenant.status).toBe(200);
            expect(byTenant.body.data.every((p: { tenantId: string }) => p.tenantId === tenant.id)).toBe(true);

            const byProperty = await testRequest()
                .get(`/api/v1/payments?propertyId=${lease.propertyId}`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(byProperty.status).toBe(200);
            expect(byProperty.body.data.every((p: { invoiceId: string }) => p.invoiceId === invoice.id)).toBe(true);
        });
    });

    describe("GET /api/v1/payments/export", () => {
        it("allows an owner to export payments as an xlsx workbook, forbids a tenant", async () => {
            const { ownerToken, tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });

            const res = await testRequest().get("/api/v1/payments/export").set("Authorization", `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toBe(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            expect(res.headers["content-disposition"]).toContain("payments.xlsx");
            expect(Number(res.headers["content-length"])).toBeGreaterThan(0);

            const forbiddenRes = await testRequest()
                .get("/api/v1/payments/export")
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(forbiddenRes.status).toBe(403);
        });
    });

    describe("GET /api/v1/payments/:id/receipt", () => {
        it("returns the presigned URL for a successful payment, 404 for a failed one", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            const payRes = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "mobile_money" });
            const paymentId = payRes.body.data.id;

            const receiptRes = await testRequest()
                .get(`/api/v1/payments/${paymentId}/receipt`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(receiptRes.status).toBe(200);
            expect(receiptRes.body.data.url).toBe("https://example.com/signed");

            const { tenantToken: failingTenantToken, invoice: failingInvoice } = await setupLeaseWithInvoice({
                amountDue: "1"
            });
            const failedPayRes = await testRequest()
                .post(`/api/v1/invoices/${failingInvoice.id}/pay`)
                .set("Authorization", `Bearer ${failingTenantToken}`)
                .send({ method: "mobile_money" });
            const failedPaymentId = failedPayRes.body.data.id;

            const failedReceiptRes = await testRequest()
                .get(`/api/v1/payments/${failedPaymentId}/receipt`)
                .set("Authorization", `Bearer ${failingTenantToken}`);
            expect(failedReceiptRes.status).toBe(404);
        });
    });

    describe("cash / bank_transfer landlord approval", () => {
        it("leaves a cash payment pending approval, then lets the owner approve it and mark the invoice paid", async () => {
            const { ownerToken, tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            const payRes = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "cash" });

            expect(payRes.status).toBe(201);
            expect(payRes.body.data.status).toBe("pending");
            expect(payRes.body.data.approvalStatus).toBe("pending");

            const invoiceAfterPay = await testRequest()
                .get(`/api/v1/invoices/${invoice.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(invoiceAfterPay.body.data.status).toBe("unpaid");

            const approveRes = await testRequest()
                .patch(`/api/v1/payments/${payRes.body.data.id}/approve`)
                .set("Authorization", `Bearer ${ownerToken}`);
            expect(approveRes.status).toBe(200);
            expect(approveRes.body.data.status).toBe("success");
            expect(approveRes.body.data.approvalStatus).toBe("approved");

            const invoiceAfterApprove = await testRequest()
                .get(`/api/v1/invoices/${invoice.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(invoiceAfterApprove.body.data.status).toBe("paid");
        });

        it("lets the owner reject a bank_transfer payment awaiting approval", async () => {
            const { ownerToken, tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });

            const payRes = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "bank_transfer" });

            const rejectRes = await testRequest()
                .patch(`/api/v1/payments/${payRes.body.data.id}/reject`)
                .set("Authorization", `Bearer ${ownerToken}`)
                .send({ reason: "Could not verify the transfer" });

            expect(rejectRes.status).toBe(200);
            expect(rejectRes.body.data.status).toBe("failed");
            expect(rejectRes.body.data.approvalStatus).toBe("rejected");

            const invoiceRes = await testRequest()
                .get(`/api/v1/invoices/${invoice.id}`)
                .set("Authorization", `Bearer ${tenantToken}`);
            expect(invoiceRes.body.data.status).toBe("unpaid");
        });

        it("forbids an unrelated owner from approving someone else's payment", async () => {
            const { tenantToken, invoice } = await setupLeaseWithInvoice({ amountDue: "1500.00" });
            const { accessToken: otherOwnerToken } = await createAuthedUser({ role: "owner" });

            const payRes = await testRequest()
                .post(`/api/v1/invoices/${invoice.id}/pay`)
                .set("Authorization", `Bearer ${tenantToken}`)
                .send({ method: "cash" });

            const approveRes = await testRequest()
                .patch(`/api/v1/payments/${payRes.body.data.id}/approve`)
                .set("Authorization", `Bearer ${otherOwnerToken}`);
            expect(approveRes.status).toBe(403);
        });
    });
});
