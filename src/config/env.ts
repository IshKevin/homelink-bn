import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

export const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT) || 3000,
    appUrl: process.env.APP_URL || "http://localhost:3000",
    appName: process.env.APP_NAME || "HomeLink",

    databaseUrl: process.env.DATABASE_URL!,

    jwtSecret: process.env.JWT_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
    jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || "15m",
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || "30d",
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
    idleTimeoutMinutes: Number(process.env.IDLE_TIMEOUT_MINUTES) || 60,
    newDeviceOtpTtlMinutes: Number(process.env.NEW_DEVICE_OTP_TTL_MINUTES) || 10,

    redisUrl: process.env.REDIS_URL!,

    s3: {
        endpoint: process.env.S3_ENDPOINT!,
        accessKey: process.env.S3_ACCESS_KEY!,
        secretKey: process.env.S3_SECRET_KEY!,
        bucket: process.env.S3_BUCKET!,
        region: process.env.S3_REGION || "us-east-1"
    },

    smtp: {
        host: process.env.SMTP_HOST || "localhost",
        port: Number(process.env.SMTP_PORT) || 1025,
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
        from: process.env.SMTP_FROM || "HomeLink <no-reply@homelink.local>"
    },

    build: {
        gitCommit: process.env.GIT_COMMIT || "unknown",
        builtAt: process.env.BUILD_TIME || "unknown",
        imageTag: process.env.IMAGE_TAG || "local"
    },

    adminEmail: process.env.ADMIN_EMAIL || undefined,

    // MTN MoMo Open API (momodeveloper.mtn.com) — Collections (charge tenant)
    // and Disbursements (pay landlord) are separate product subscriptions
    // with their own credentials. Left unset in an environment without real
    // credentials yet; see services/payments/payment.service.ts for the
    // mock-provider fallback that keeps that environment working anyway.
    momo: {
        baseUrl: process.env.MTN_MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com",
        targetEnvironment: process.env.MTN_MOMO_TARGET_ENVIRONMENT || "sandbox",
        // Base URL MTN calls back to (X-Callback-Url) — this app's own public
        // API origin, i.e. APP_URL, not MTN's.
        callbackBaseUrl: process.env.MTN_MOMO_CALLBACK_BASE_URL || process.env.APP_URL || "http://localhost:3000",
        currency: process.env.MTN_MOMO_CURRENCY || "EUR", // sandbox only accepts EUR; production uses RWF
        collection: {
            subscriptionKey: process.env.MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY || "",
            apiUser: process.env.MTN_MOMO_COLLECTION_API_USER || "",
            apiKey: process.env.MTN_MOMO_COLLECTION_API_KEY || ""
        },
        disbursement: {
            subscriptionKey: process.env.MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY || "",
            apiUser: process.env.MTN_MOMO_DISBURSEMENT_API_USER || "",
            apiKey: process.env.MTN_MOMO_DISBURSEMENT_API_KEY || ""
        }
    },

    // EventBridge: published when a tenant payment succeeds, so disbursement
    // to the landlord happens as a decoupled, automatic reaction rather than
    // inline in the payment request — see jobs/handlers/processPayoutEvents.job.ts.
    eventBridge: {
        region: process.env.AWS_REGION || process.env.S3_REGION || "eu-west-1",
        busName: process.env.EVENTBRIDGE_BUS_NAME || "",
        payoutQueueUrl: process.env.PAYOUT_EVENTS_QUEUE_URL || ""
    }
};