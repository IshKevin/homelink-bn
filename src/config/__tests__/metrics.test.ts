import { testRequest } from "../../../tests/helpers/app";

describe("GET /metrics", () => {
    it("exposes HTTP and business metrics in Prometheus text format", async () => {
        // Generate at least one real HTTP request for the counter to have picked up.
        await testRequest().get("/api/v1/health");

        const res = await testRequest().get("/metrics");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/text\/plain/);

        expect(res.text).toContain("homelink_http_requests_total");
        expect(res.text).toContain("homelink_http_request_duration_seconds");
        expect(res.text).toContain("homelink_logins_total");
        expect(res.text).toContain("homelink_registrations_total");
        expect(res.text).toContain("homelink_payments_total");
        expect(res.text).toContain("homelink_leases_created_total");
        expect(res.text).toContain("homelink_users_total");
        expect(res.text).toContain("homelink_properties_total");
        expect(res.text).toContain("homelink_units_total");
        expect(res.text).toContain("homelink_leases_total");
        expect(res.text).toContain("homelink_invoices_total");
        expect(res.text).toContain("homelink_audit_actions_total");
        expect(res.text).toContain("homelink_active_sessions_total");
    });
});
