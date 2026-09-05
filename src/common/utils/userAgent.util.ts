import { UAParser } from "ua-parser-js";

export interface DeviceLabels {
    deviceType: string;
    browser: string;
    os: string;
}

// Coarse, low-cardinality labels for Prometheus (see src/config/metrics.ts)
// — never the raw user-agent string itself, which would blow up label
// cardinality and isn't something we want surfaced in Grafana anyway.
export function parseDeviceLabels(userAgent: string | null | undefined): DeviceLabels {
    if (!userAgent) return { deviceType: "unknown", browser: "unknown", os: "unknown" };

    const result = UAParser(userAgent);
    return {
        deviceType: result.device.type ?? "desktop",
        browser: result.browser.name ?? "unknown",
        os: result.os.name ?? "unknown"
    };
}
