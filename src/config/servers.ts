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

function isLocalHost(): boolean {
    try {
        const { hostname } = new URL(env.appUrl);
        return hostname === "localhost" || hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

// minio/mailpit's admin ports are bound to the host's loopback only (see docker-compose.yml),
// so on a remote box they're only reachable via `ssh -L <port>:localhost:<port> user@host`,
// after which you browse to localhost on your OWN machine — not the server's public host.
const TUNNEL_NOTE =
    "Not publicly reachable. Tunnel first: ssh -L PORT:localhost:PORT user@your-server, then open this URL on your machine.";

export interface ImageServerInfo {
    endpoint: string;
    bucket: string;
    console: string | null;
    note?: string;
}

export function getImageServer(): ImageServerInfo {
    const selfHosted = env.s3.endpoint.includes("minio");
    if (!selfHosted) {
        return { endpoint: env.s3.endpoint, bucket: env.s3.bucket, console: null };
    }

    return {
        endpoint: env.s3.endpoint,
        bucket: env.s3.bucket,
        console: "http://localhost:9001",
        ...(isLocalHost() ? {} : { note: TUNNEL_NOTE.replaceAll("PORT", "9001") })
    };
}

export interface EmailServerInfo {
    host: string;
    webUI: string | null;
    note?: string;
}

export function getEmailServer(): EmailServerInfo {
    const selfHosted = env.smtp.host.includes("mailpit");
    if (!selfHosted) {
        return { host: env.smtp.host, webUI: null };
    }

    return {
        host: env.smtp.host,
        webUI: "http://localhost:8025",
        ...(isLocalHost() ? {} : { note: TUNNEL_NOTE.replaceAll("PORT", "8025") })
    };
}
