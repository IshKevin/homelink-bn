import dotenv from "dotenv";

dotenv.config();

export const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: process.env.PORT || 3000,

    databaseUrl: process.env.DATABASE_URL!,

    jwtSecret: process.env.JWT_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,

    redisUrl: process.env.REDIS_URL!,

    s3: {
        endpoint: process.env.S3_ENDPOINT!,
        accessKey: process.env.S3_ACCESS_KEY!,
        secretKey: process.env.S3_SECRET_KEY!,
        bucket: process.env.S3_BUCKET!
    }
};