import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import type {
    MtnMomoProduct,
    MtnMomoRequestToPayInput,
    MtnMomoStatusResult,
    MtnMomoTransferInput
} from "./types";

/**
 * Client for MTN's MoMo Open API (https://momodeveloper.mtn.com), covering
 * the two products this app needs:
 *   - Collections: "Request to Pay" — charges the tenant.
 *   - Disbursements: "Transfer" — pays the landlord.
 * Both are asynchronous — a 202 here only means MTN accepted the request;
 * the actual outcome arrives via the callback MTN posts to `callbackUrl`
 * (see webhooks.routes.ts), with GET-status polling as a fallback.
 */

interface ProductCredentials {
    subscriptionKey: string;
    apiUser: string;
    apiKey: string;
}

function credentialsFor(product: MtnMomoProduct): ProductCredentials {
    return product === "collection" ? env.momo.collection : env.momo.disbursement;
}

// SSM stores unset credentials as the literal string "unset" (SSM rejects
// truly empty values) — see infra/terraform/ssm.tf's mtn_momo_* params and
// the identical convention for GHCR_TOKEN in user-data/*.sh.tpl. A plain
// truthiness check would treat that sentinel as "configured", since it's a
// non-empty string.
function isRealValue(value: string): boolean {
    return value !== "" && value !== "unset";
}

export function isMtnMomoConfigured(product: MtnMomoProduct): boolean {
    const c = credentialsFor(product);
    return isRealValue(c.subscriptionKey) && isRealValue(c.apiUser) && isRealValue(c.apiKey);
}

// Tokens expire (typically ~1h); cached per product and refreshed a minute
// before actual expiry so a request never races an about-to-expire token.
const tokenCache: Partial<Record<MtnMomoProduct, { accessToken: string; expiresAt: number }>> = {};

async function getAccessToken(product: MtnMomoProduct): Promise<string> {
    const cached = tokenCache[product];
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

    const creds = credentialsFor(product);
    const basicAuth = Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString("base64");

    const res = await fetch(`${env.momo.baseUrl}/${product}/token/`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            "Ocp-Apim-Subscription-Key": creds.subscriptionKey
        }
    });

    if (!res.ok) {
        throw new Error(`MTN MoMo (${product}) token request failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { access_token: string; expires_in: number };
    tokenCache[product] = {
        accessToken: body.access_token,
        expiresAt: Date.now() + (body.expires_in - 60) * 1000
    };
    return body.access_token;
}

async function mtnFetch(product: MtnMomoProduct, path: string, init: RequestInit): Promise<Response> {
    const creds = credentialsFor(product);
    const token = await getAccessToken(product);

    return fetch(`${env.momo.baseUrl}${path}`, {
        ...init,
        headers: {
            ...init.headers,
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": creds.subscriptionKey,
            "X-Target-Environment": env.momo.targetEnvironment,
            "Content-Type": "application/json"
        }
    });
}

export async function requestToPay(input: MtnMomoRequestToPayInput): Promise<void> {
    const res = await mtnFetch("collection", "/collection/v1_0/requesttopay", {
        method: "POST",
        headers: {
            "X-Reference-Id": input.referenceId,
            ...(input.callbackUrl ? { "X-Callback-Url": input.callbackUrl } : {})
        },
        body: JSON.stringify({
            amount: input.amount,
            currency: input.currency,
            externalId: input.externalId,
            payer: { partyIdType: "MSISDN", partyId: input.payerPhone },
            payerMessage: input.payerMessage,
            payeeNote: input.payeeNote
        })
    });

    if (res.status !== 202) {
        throw new Error(`MTN MoMo requestToPay failed: ${res.status} ${await res.text()}`);
    }
    logger.info({ referenceId: input.referenceId }, "MTN MoMo requestToPay accepted");
}

export async function getRequestToPayStatus(referenceId: string): Promise<MtnMomoStatusResult> {
    const res = await mtnFetch("collection", `/collection/v1_0/requesttopay/${referenceId}`, {
        method: "GET"
    });
    if (!res.ok) {
        throw new Error(`MTN MoMo requestToPay status check failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as MtnMomoStatusResult;
}

export async function transfer(input: MtnMomoTransferInput): Promise<void> {
    const res = await mtnFetch("disbursement", "/disbursement/v1_0/transfer", {
        method: "POST",
        headers: {
            "X-Reference-Id": input.referenceId,
            ...(input.callbackUrl ? { "X-Callback-Url": input.callbackUrl } : {})
        },
        body: JSON.stringify({
            amount: input.amount,
            currency: input.currency,
            externalId: input.externalId,
            payee: { partyIdType: "MSISDN", partyId: input.payeePhone },
            payerMessage: input.payerMessage,
            payeeNote: input.payeeNote
        })
    });

    if (res.status !== 202) {
        throw new Error(`MTN MoMo transfer failed: ${res.status} ${await res.text()}`);
    }
    logger.info({ referenceId: input.referenceId }, "MTN MoMo transfer (disbursement) accepted");
}

export async function getTransferStatus(referenceId: string): Promise<MtnMomoStatusResult> {
    const res = await mtnFetch("disbursement", `/disbursement/v1_0/transfer/${referenceId}`, {
        method: "GET"
    });
    if (!res.ok) {
        throw new Error(`MTN MoMo transfer status check failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as MtnMomoStatusResult;
}
