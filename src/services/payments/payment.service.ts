import type { PaymentProvider } from "./payment.provider";
import { MockBankTransferProvider, MockMobileMoneyProvider } from "./mockProviders";

const providers: Record<string, PaymentProvider> = {
    mobile_money: new MockMobileMoneyProvider(),
    bank_transfer: new MockBankTransferProvider()
};

export function getPaymentProvider(method: "mobile_money" | "bank_transfer"): PaymentProvider {
    const provider = providers[method];
    if (!provider) {
        throw new Error(`No payment provider registered for method: ${method}`);
    }
    return provider;
}
