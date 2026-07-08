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
