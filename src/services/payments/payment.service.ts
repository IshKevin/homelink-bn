import type { PaymentProvider } from "./payment.provider";
import { MockAirtelMoneyProvider, MockBankTransferProvider, MockMobileMoneyProvider } from "./mockProviders";
import { MtnMomoCollectionProvider } from "./mtnMomoProvider";
import { isMtnMomoConfigured } from "./mtnMomo/client";

const mockMobileMoneyProviders: Record<"mtn" | "airtel", PaymentProvider> = {
    mtn: new MockMobileMoneyProvider(),
    airtel: new MockAirtelMoneyProvider()
};

// Airtel Money has no real integration yet — only MTN's real credentials
// (isMtnMomoConfigured) switch the mock out. Everything else (Airtel, bank
// transfer) stays mocked until those get built the same way.
const realMtnProvider = new MtnMomoCollectionProvider();

const bankTransferProvider = new MockBankTransferProvider();

export function getPaymentProvider(
    method: "mobile_money" | "bank_transfer",
    carrier: "mtn" | "airtel" = "mtn"
): PaymentProvider {
    if (method === "mobile_money") {
        if (carrier === "mtn" && isMtnMomoConfigured("collection")) {
            return realMtnProvider;
        }
        return mockMobileMoneyProviders[carrier];
    }
    return bankTransferProvider;
}
