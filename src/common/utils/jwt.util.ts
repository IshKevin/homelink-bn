import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../../config/env";

export interface AccessTokenPayload {
    sub: string;
    role: string;
    email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessExpiry } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}

export function signRefreshToken(payload: { sub: string }): string {
    return jwt.sign({ ...payload, jti: crypto.randomUUID() }, env.jwtRefreshSecret, {
        expiresIn: env.jwtRefreshExpiry
    } as SignOptions);
}

export function verifyRefreshToken(token: string): { sub: string } {
    return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
}

export function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateRawToken(): string {
    return crypto.randomBytes(32).toString("hex");
}
