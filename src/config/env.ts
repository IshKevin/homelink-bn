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

    adminEmail: process.env.ADMIN_EMAIL || undefined
};