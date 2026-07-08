import { env } from "./env";

export interface ApiServer {
    url: string;
    description: string;
}

const PRODUCTION_URL = "https://homelink-bn.onrender.com";

export function getApiServers(basePath = ""): ApiServer[] {
    const servers: ApiServer[] = [{ url: `${env.appUrl}${basePath}`, description: `${env.nodeEnv} server` }];

    if (env.appUrl !== PRODUCTION_URL) {
        servers.push({ url: `${PRODUCTION_URL}${basePath}`, description: "Production server" });
    }

    return servers;
}

function samePublicHost(port: number): string | null {
    try {
        const { protocol, hostname } = new URL(env.appUrl);
        return `${protocol}//${hostname}:${port}`;
    } catch {
        return null;
    }
}

export interface ImageServerInfo {
    endpoint: string;
    bucket: string;
    console: string | null;
}

export function getImageServer(): ImageServerInfo {
    const selfHosted = env.s3.endpoint.includes("minio");
    return {
        endpoint: env.s3.endpoint,
        bucket: env.s3.bucket,
        console: selfHosted ? samePublicHost(9001) : null
    };
}

export interface EmailServerInfo {
    host: string;
    webUI: string | null;
}

export function getEmailServer(): EmailServerInfo {
    const selfHosted = env.smtp.host.includes("mailpit");
    return {
        host: env.smtp.host,
        webUI: selfHosted ? samePublicHost(8025) : null
    };
}
