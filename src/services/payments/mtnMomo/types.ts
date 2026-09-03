export type MtnMomoProduct = "collection" | "disbursement";

/** MTN's own status vocabulary, distinct from this app's payment/payout status enums. */
export type MtnMomoRequestStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

export interface MtnMomoParty {
    partyIdType: "MSISDN";
    partyId: string;
}

export interface MtnMomoRequestToPayInput {
    referenceId: string;
    amount: string;
    currency: string;
    externalId: string;
    payerPhone: string;
    payerMessage: string;
    payeeNote: string;
    callbackUrl?: string | undefined;
}

export interface MtnMomoTransferInput {
    referenceId: string;
    amount: string;
    currency: string;
    externalId: string;
    payeePhone: string;
    payerMessage: string;
    payeeNote: string;
    callbackUrl?: string | undefined;
}

export interface MtnMomoStatusResult {
    amount: string;
    currency: string;
    externalId: string;
    status: MtnMomoRequestStatus;
    financialTransactionId?: string | undefined;
    reason?: string | undefined;
}
