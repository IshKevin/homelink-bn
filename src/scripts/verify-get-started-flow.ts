/**
 * End-to-end smoke test for the "Get Started" pending-approval flow, run
 * against a REAL running server over HTTP (not the Jest/mocked-email suite
 * in src/modules/auth/__tests__ and src/modules/admin/__tests__ — those hit
 * the service layer directly with sendMail mocked out; this script is for
 * verifying an actual deployment/dev server end to end).
 *
 * What it checks:
 *   1. POST /auth/register issues NO tokens and creates the account
 *      unapproved, for both owner and agent.
 *   2. Logging in on a pending account is rejected (it has no password yet).
 *   3. The admin "approve" endpoint flips isApproved and the account is
 *      still unusable until a password is set.
 *   4. Approving twice is rejected with a conflict (idempotency guard).
 *   5. Only owner/agent accounts are approvable this way (a tenant is
 *      rejected with a 400).
 *
 * What it can't check automatically: whether the approval email actually
 * arrives, since that depends on your SMTP setup. Run once to get to the
 * "check your inbox" step, copy the token out of the set-password link in
 * the email, then re-run with SET_PASSWORD_TOKEN set to finish the last two
 * checks (setting the password and logging in with it).
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret \
 *     npx ts-node --transpile-only src/scripts/verify-get-started-flow.ts
 *
 *   # after checking the inbox for the owner's approval email:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... SET_PASSWORD_TOKEN=<token-from-link> \
 *     npx ts-node --transpile-only src/scripts/verify-get-started-flow.ts
 *
 * Env vars:
 *   BASE_URL            default http://localhost:3000/api/v1
 *   ADMIN_EMAIL          required — an existing admin/superadmin account
 *   ADMIN_PASSWORD        required
 *   SET_PASSWORD_TOKEN   optional — token from the approval email's link,
 *                        to verify the final set-password + login step
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000/api/v1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SET_PASSWORD_TOKEN = process.env.SET_PASSWORD_TOKEN;

const RUN_ID = Date.now();
const OWNER_EMAIL = `verify-owner-${RUN_ID}@example.com`;
const AGENT_EMAIL = `verify-agent-${RUN_ID}@example.com`;

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${label}`);
        if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`);
    }
}

async function call(
    method: string,
    path: string,
    body?: unknown,
    token?: string
): Promise<{ status: number; json: any }> {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function registerAndCheckPending(email: string, role: "owner" | "agent") {
    console.log(`\n[register] ${role}: POST /auth/register (${email})`);
    const res = await call("POST", "/auth/register", {
        email,
        firstName: "Verify",
        lastName: role,
        phone: "0788000000",
        role
    });

    ok("responds 201", res.status === 201, res.json);
    ok("issues no accessToken", res.json?.data?.accessToken === undefined, res.json?.data);
    ok("issues no refreshToken", res.json?.data?.refreshToken === undefined, res.json?.data);
    ok("user.isApproved is false", res.json?.data?.user?.isApproved === false, res.json?.data?.user);
    ok("user.passwordHash is not exposed", res.json?.data?.user?.passwordHash === undefined);

    console.log(`[register] ${role}: POST /auth/login with a guessed password should fail`);
    const loginRes = await call("POST", "/auth/login", { identifier: email, password: "WhateverGuess1!" });
    ok("login is rejected while pending", loginRes.status === 401 || loginRes.status === 403, loginRes.json);

    return res.json?.data?.user?.id as string | undefined;
}

async function main() {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.error(
            "Set ADMIN_EMAIL and ADMIN_PASSWORD to an existing admin/superadmin account first\n" +
                "(the same env vars src/scripts/seed-admin.ts uses — run `npm run seed:admin` if you need one)."
        );
        process.exit(1);
    }

    console.log(`Target: ${BASE_URL}`);

    const ownerId = await registerAndCheckPending(OWNER_EMAIL, "owner");
    const agentId = await registerAndCheckPending(AGENT_EMAIL, "agent");

    console.log("\n[admin] POST /auth/login as admin");
    const adminLogin = await call("POST", "/auth/login", {
        identifier: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
    });
    const adminToken: string | undefined = adminLogin.json?.data?.accessToken;
    ok("admin login succeeds", adminLogin.status === 200 && Boolean(adminToken), adminLogin.json);

    if (!adminToken || !ownerId) {
        console.log("\nCan't continue without an admin token and a registered owner id — stopping here.");
        summarize();
        return;
    }

    console.log("\n[admin] PATCH /admin/users/:id/approve on a tenant should be rejected");
    const tenantLookup = await call(
        "GET",
        `/admin/users?role=tenant&limit=1`,
        undefined,
        adminToken
    );
    const someTenantId: string | undefined = tenantLookup.json?.data?.[0]?.id;
    if (someTenantId) {
        const badApprove = await call("PATCH", `/admin/users/${someTenantId}/approve`, undefined, adminToken);
        ok("rejects approving a tenant with 400", badApprove.status === 400, badApprove.json);
    } else {
        console.log("  (skipped — no tenant found to test against)");
    }

    console.log(`\n[admin] PATCH /admin/users/${ownerId}/approve`);
    const approveRes = await call("PATCH", `/admin/users/${ownerId}/approve`, undefined, adminToken);
    ok("approves the pending owner", approveRes.status === 200, approveRes.json);
    ok("isApproved flips to true", approveRes.json?.data?.isApproved === true, approveRes.json?.data);

    console.log(`[admin] PATCH /admin/users/${ownerId}/approve again should conflict`);
    const reapproveRes = await call("PATCH", `/admin/users/${ownerId}/approve`, undefined, adminToken);
    ok("re-approving the same account is rejected with 409", reapproveRes.status === 409, reapproveRes.json);

    if (agentId) {
        console.log(`[admin] PATCH /admin/users/${agentId}/approve (agent too)`);
        const agentApprove = await call("PATCH", `/admin/users/${agentId}/approve`, undefined, adminToken);
        ok("approves the pending agent", agentApprove.status === 200 && agentApprove.json?.data?.isApproved === true, agentApprove.json);
    }

    console.log(`\n[login] approved-but-no-password-set owner should still fail login (wrong credentials, not "pending")`);
    const stillNoPassword = await call("POST", "/auth/login", {
        identifier: OWNER_EMAIL,
        password: "StillAGuess1!"
    });
    ok("still rejected (401, not 403 pending)", stillNoPassword.status === 401, stillNoPassword.json);

    if (!SET_PASSWORD_TOKEN) {
        console.log(
            `\n\x1b[33m→ Next step:\x1b[0m check ${OWNER_EMAIL}'s inbox (or your dev SMTP catcher) for\n` +
                `  "Your HomeLink account has been approved", copy the token out of the\n` +
                `  /set-password?token=... link, then re-run this script with:\n\n` +
                `    SET_PASSWORD_TOKEN=<token> ADMIN_EMAIL=${ADMIN_EMAIL} ADMIN_PASSWORD=*** \\\n` +
                `      npx ts-node --transpile-only src/scripts/verify-get-started-flow.ts\n\n` +
                `  to verify the set-password + login step too. (It registers a fresh\n` +
                `  owner/agent pair each run, so re-running is safe.)`
        );
    } else {
        console.log("\n[set-password] POST /auth/reset-password with the token from the email");
        const newPassword = "VerifiedPass1!";
        const setRes = await call("POST", "/auth/reset-password", {
            token: SET_PASSWORD_TOKEN,
            newPassword
        });
        ok("sets the password", setRes.status === 200, setRes.json);

        console.log("[set-password] POST /auth/login with the new password");
        const finalLogin = await call("POST", "/auth/login", {
            identifier: OWNER_EMAIL,
            password: newPassword
        });
        ok(
            "logs in successfully with the freshly set password",
            finalLogin.status === 200 && Boolean(finalLogin.json?.data?.accessToken),
            finalLogin.json
        );
    }

    summarize();
}

function summarize() {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
    console.error("Script crashed:", err);
    process.exitCode = 1;
});
