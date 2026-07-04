import crypto from "node:crypto";
import type { InitiatePaymentInput, PaymentProvider, PaymentResult } from "./payment.provider";

/**
 * Placeholder gateways. Real integrations (MTN/Airtel Mobile Money, bank APIs) are
 * asynchronous and webhook-driven; these mocks resolve synchronously so the rest of the
 * platform (invoices, receipts, notifications) can be built and tested against a stable
 * contract now, and swapped for real providers later without touching calling code.
 *
 * Amount `1` (of any currency unit) deterministically fails, to make the failure path testable.
 */
async function simulate(providerName: string, input: InitiatePaymentInput): Promise<PaymentResult> {
    const providerReference = `${providerName.toUpperCase().replace(/\s+/g, "_")}-${crypto.randomUUID()}`;

    if (input.amount === 1) {
        return { providerReference, status: "failed", failureReason: "Simulated insufficient funds" };
    }

    return { providerReference, status: "success" };
}

export class MockMobileMoneyProvider implements PaymentProvider {
    readonly name = "mobile_money";

    async initiate(input: InitiatePaymentInput): Promise<PaymentResult> {
        return simulate("mobile_money", input);
    }
}

export class MockBankTransferProvider implements PaymentProvider {
    readonly name = "bank_transfer";

    async initiate(input: InitiatePaymentInput): Promise<PaymentResult> {
        return simulate("bank_transfer", input);
    }
}
