#!/usr/bin/env node
"use strict";

// One-off helper: provisions an MTN MoMo sandbox API user + API key from your
// subscription key, per MTN's two-step setup (https://momodeveloper.mtn.com).
// Run with: node scripts/momo-setup.js
// Then copy the printed MOMO_API_USER / MOMO_API_KEY into your .env.

const crypto = require("node:crypto");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const baseUrl = process.env.MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com";
// Provisioning (create API user / API key) uses the separate "Sandbox User
// (Provisioning)" product's key, not the Collections key used for payments.
const subscriptionKey = process.env.MOMO_PROVISIONING_SUBSCRIPTION_KEY;
const callbackHost = process.env.MOMO_CALLBACK_BASE_URL
    ? new URL(process.env.MOMO_CALLBACK_BASE_URL).host
    : "localhost";

async function main() {
    if (!subscriptionKey) {
        console.error("MOMO_PROVISIONING_SUBSCRIPTION_KEY is not set in .env — add it before running this.");
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

    console.log("\nSandbox API user + key created. Add these to your .env:\n");
    console.log(`MOMO_API_USER=${apiUser}`);
    console.log(`MOMO_API_KEY=${apiKey}`);
    console.log("");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
