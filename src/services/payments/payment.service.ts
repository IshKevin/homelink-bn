import type { PaymentProvider } from "./payment.provider";
import { MockAirtelMoneyProvider, MockBankTransferProvider, MockMobileMoneyProvider } from "./mockProviders";

const mobileMoneyProviders: Record<"mtn" | "airtel", PaymentProvider> = {
    mtn: new MockMobileMoneyProvider(),
    airtel: new MockAirtelMoneyProvider()
};

const bankTransferProvider = new MockBankTransferProvider();

export function getPaymentProvider(
    method: "mobile_money" | "bank_transfer",
    carrier: "mtn" | "airtel" = "mtn"
): PaymentProvider {
    if (method === "mobile_money") {
        return mobileMoneyProviders[carrier];
    }
    return bankTransferProvider;
}
