import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { env } from "../../config/env";

export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, env.bcryptSaltRounds);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}

// Ambiguous characters (0/O, 1/l/I) left out since this is meant to be read
// off a screen and retyped, or relayed over WhatsApp/SMS by a landlord.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 10): string {
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
        out += TEMP_PASSWORD_ALPHABET[bytes[i]! % TEMP_PASSWORD_ALPHABET.length];
    }
    return out;
}

// A tenant's permanent login identifier — uppercase only (unambiguous when
// read aloud/relayed by a landlord), same excluded-character rationale as
// above.
const LOGIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateLoginCode(length = 8): string {
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
        out += LOGIN_CODE_ALPHABET[bytes[i]! % LOGIN_CODE_ALPHABET.length];
    }
    return out;
}
