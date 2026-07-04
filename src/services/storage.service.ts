import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { env } from "../config/env";

const s3 = new S3Client({
    endpoint: env.s3.endpoint,
    region: env.s3.region,
    forcePathStyle: true,
    credentials: {
        accessKeyId: env.s3.accessKey,
        secretAccessKey: env.s3.secretKey
    }
});

export function buildObjectKey(folder: string, originalName: string): string {
    const ext = originalName.includes(".") ? originalName.split(".").pop() : undefined;
    const unique = crypto.randomUUID();
    return ext ? `${folder}/${unique}.${ext}` : `${folder}/${unique}`;
}

export async function uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await s3.send(
        new PutObjectCommand({
            Bucket: env.s3.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType
        })
    );
    return key;
}

export async function getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }), {
        expiresIn: expiresInSeconds
    });
}

export async function deleteObject(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}
