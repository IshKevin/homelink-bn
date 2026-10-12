#!/usr/bin/env node
"use strict";

// One-off helper: provisions an MTN MoMo sandbox API user + API key from a
// subscription key, per MTN's two-step setup (https://momodeveloper.mtn.com).
// Run once per product you've subscribed to (Collections, then
// Disbursements), pointing SCOPE at whichever one you're provisioning:
//   MOMO_SETUP_SCOPE=collection node scripts/momo-setup.js
//   MOMO_SETUP_SCOPE=disbursement node scripts/momo-setup.js
// Then copy the printed values into the matching MTN_MOMO_<SCOPE>_API_USER /
// MTN_MOMO_<SCOPE>_API_KEY in your .env.

const crypto = require("node:crypto");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const baseUrl = process.env.MTN_MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com";
const scope = (process.env.MOMO_SETUP_SCOPE || "collection").toLowerCase();
const subscriptionKey =
    scope === "disbursement"
        ? process.env.MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY
        : process.env.MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY;
const callbackHost = process.env.MTN_MOMO_CALLBACK_BASE_URL
    ? new URL(process.env.MTN_MOMO_CALLBACK_BASE_URL).host
    : "localhost";

async function main() {
    if (scope !== "collection" && scope !== "disbursement") {
        console.error(`MOMO_SETUP_SCOPE must be "collection" or "disbursement", got "${scope}".`);
        process.exitCode = 1;
        return;
    }

    if (!subscriptionKey) {
        console.error(
            `MTN_MOMO_${scope.toUpperCase()}_SUBSCRIPTION_KEY is not set in .env — add it before running this.`
        );
        process.exitCode = 1;
        return;
    }

    const apiUser = crypto.randomUUID();

    const createUserRes = await fetch(`${baseUrl}/v1_0/apiuser`, {
        method: "POST",
        headers: {
            "X-Reference-Id": apiUser,
            "Ocp-Apim-Subscription-Key": subscriptionKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ providerCallbackHost: callbackHost })
    });

    if (createUserRes.status !== 201) {
        console.error(`Failed to create API user: ${createUserRes.status} ${await createUserRes.text()}`);
        process.exitCode = 1;
        return;
    }

    const apiKeyRes = await fetch(`${baseUrl}/v1_0/apiuser/${apiUser}/apikey`, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": subscriptionKey }
    });

    if (!apiKeyRes.ok) {
        console.error(`Failed to create API key: ${apiKeyRes.status} ${await apiKeyRes.text()}`);
        process.exitCode = 1;
        return;
    }

    const { apiKey } = await apiKeyRes.json();

    const prefix = `MTN_MOMO_${scope.toUpperCase()}`;
    console.log(`\nSandbox API user + key created for ${scope}. Add these to your .env:\n`);
    console.log(`${prefix}_API_USER=${apiUser}`);
    console.log(`${prefix}_API_KEY=${apiKey}`);
    console.log("");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
