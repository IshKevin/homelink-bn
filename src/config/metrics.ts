import client from "prom-client";
import { and, gt, isNull, sql } from "drizzle-orm";
import { db } from "../database";
import { invoices, leases, properties, propertyUnits, refreshTokens, users } from "../database/schema";
import { parseDeviceLabels } from "../common/utils/userAgent.util";

// Scraped by Prometheus on the Jenkins box over this app box's PRIVATE IP
// (see infra/terraform/user-data/jenkins.sh.tpl's `app-api` job) — never
// through Caddy/the public hostname, which explicitly 404s /metrics (see
// infra/Caddyfile). Security-group rules are what actually enforce that:
// only the jenkins security group can reach this box on the app's own port
// at all, mirroring node/cadvisor/postgres/redis-exporter's existing model.
export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new client.Counter({
    name: "homelink_http_requests_total",
    help: "Total HTTP requests handled by the API",
    labelNames: ["method", "route", "status_code"],
    registers: [metricsRegistry]
});

export const httpRequestDurationSeconds = new client.Histogram({
    name: "homelink_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    registers: [metricsRegistry]
});

export const loginsTotal = new client.Counter({
    name: "homelink_logins_total",
    help: "Login attempts, by outcome",
    labelNames: ["outcome"], // success | invalid_credentials | deactivated | challenge_issued
    registers: [metricsRegistry]
});

export const registrationsTotal = new client.Counter({
    name: "homelink_registrations_total",
    help: "New self-service registrations, by role",
    labelNames: ["role"],
    registers: [metricsRegistry]
});

export const paymentsTotal = new client.Counter({
    name: "homelink_payments_total",
    help: "Payment attempts, by method and outcome",
    labelNames: ["method", "outcome"], // outcome: success | failed | pending
    registers: [metricsRegistry]
});

export const leasesCreatedTotal = new client.Counter({
    name: "homelink_leases_created_total",
    help: "Leases created, by whether a brand-new tenant account was registered alongside it",
    labelNames: ["new_tenant"], // "true" | "false"
    registers: [metricsRegistry]
});

// "Who's using the system and what are they doing" — without ever putting
// a raw IP address, user-agent string, or individual user's identity in
// Grafana. Both are aggregate counts only.
export const auditActionsTotal = new client.Counter({
    name: "homelink_audit_actions_total",
    help: "Every recorded action, by type (see services/audit.service.ts)",
    labelNames: ["action"],
    registers: [metricsRegistry]
});

// --- Business-state gauges ---------------------------------------------
// Unlike the counters above (which only move forward), these reflect
// current state and are recomputed with a handful of cheap COUNT/GROUP BY
// queries every time Prometheus scrapes (~every 15s) — deliberately kept to
// simple aggregates, not exposing row-level data. This is what answers
// "who's actually using the system" without needing a second, separately
// exposed path into the database (Postgres itself only listens on this
// box's loopback interface — see docker-compose.yml — so this is the one
// sanctioned way business data reaches Grafana).

void new client.Gauge({
    name: "homelink_users_total",
    help: "Current users, by role",
    labelNames: ["role"],
    async collect() {
        const rows = await db.select({ role: users.role, count: sql<number>`count(*)::int` }).from(users).groupBy(users.role);
        for (const row of rows) this.set({ role: row.role }, row.count);
    },
    registers: [metricsRegistry]
});

void new client.Gauge({
    name: "homelink_properties_total",
    help: "Current properties, by status",
    labelNames: ["status"],
    async collect() {
        const rows = await db
            .select({ status: properties.status, count: sql<number>`count(*)::int` })
            .from(properties)
            .groupBy(properties.status);
        for (const row of rows) this.set({ status: row.status }, row.count);
    },
    registers: [metricsRegistry]
});

void new client.Gauge({
    name: "homelink_units_total",
    help: "Current property units, by status",
    labelNames: ["status"],
    async collect() {
        const rows = await db
            .select({ status: propertyUnits.status, count: sql<number>`count(*)::int` })
            .from(propertyUnits)
            .groupBy(propertyUnits.status);
        for (const row of rows) this.set({ status: row.status }, row.count);
    },
    registers: [metricsRegistry]
});

void new client.Gauge({
    name: "homelink_leases_total",
    help: "Current leases, by status",
    labelNames: ["status"],
    async collect() {
        const rows = await db.select({ status: leases.status, count: sql<number>`count(*)::int` }).from(leases).groupBy(leases.status);
        for (const row of rows) this.set({ status: row.status }, row.count);
    },
    registers: [metricsRegistry]
});

void new client.Gauge({
    name: "homelink_invoices_total",
    help: "Current invoices, by status",
    labelNames: ["status"],
    async collect() {
        const rows = await db
            .select({ status: invoices.status, count: sql<number>`count(*)::int` })
            .from(invoices)
            .groupBy(invoices.status);
        for (const row of rows) this.set({ status: row.status }, row.count);
    },
    registers: [metricsRegistry]
});

// Currently-live sessions (not revoked, not expired), grouped by parsed
// device/browser/OS — "what devices are using the system right now"
// without ever exposing a raw user-agent string or which specific user it
// belongs to. Grouping happens in JS since the device labels are derived
// from parsing the stored user-agent, not a column Postgres can GROUP BY.
void new client.Gauge({
    name: "homelink_active_sessions_total",
    help: "Currently active sessions (unexpired, unrevoked refresh tokens), by device type/browser/OS",
    labelNames: ["device_type", "browser", "os"],
    async collect() {
        const rows = await db
            .select({ userAgent: refreshTokens.userAgent })
            .from(refreshTokens)
            .where(and(isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())));

        const counts = new Map<string, { labels: { device_type: string; browser: string; os: string }; count: number }>();
        for (const row of rows) {
            const { deviceType, browser, os } = parseDeviceLabels(row.userAgent);
            const key = JSON.stringify([deviceType, browser, os]);
            const existing = counts.get(key);
            if (existing) {
                existing.count++;
            } else {
                counts.set(key, { labels: { device_type: deviceType, browser, os }, count: 1 });
            }
        }

        this.reset();
        for (const { labels, count } of counts.values()) {
            this.set(labels, count);
        }
    },
    registers: [metricsRegistry]
});
