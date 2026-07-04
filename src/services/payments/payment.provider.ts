export interface InitiatePaymentInput {
    amount: number;
    reference: string;
    payerPhone?: string | undefined;
    payerAccount?: string | undefined;
}

export interface PaymentResult {
    providerReference: string;
    status: "success" | "failed" | "pending";
    failureReason?: string;
}

export interface PaymentProvider {
    readonly name: string;
    initiate(input: InitiatePaymentInput): Promise<PaymentResult>;
}
