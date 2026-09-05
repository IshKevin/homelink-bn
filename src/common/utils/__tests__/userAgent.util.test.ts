import { parseDeviceLabels } from "../userAgent.util";

describe("parseDeviceLabels", () => {
    it("returns unknown labels for a missing user-agent", () => {
        expect(parseDeviceLabels(null)).toEqual({ deviceType: "unknown", browser: "unknown", os: "unknown" });
        expect(parseDeviceLabels(undefined)).toEqual({ deviceType: "unknown", browser: "unknown", os: "unknown" });
        expect(parseDeviceLabels("")).toEqual({ deviceType: "unknown", browser: "unknown", os: "unknown" });
    });

    it("parses a desktop Chrome/Windows user-agent", () => {
        const ua =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        const result = parseDeviceLabels(ua);
        expect(result.deviceType).toBe("desktop");
        expect(result.browser).toBe("Chrome");
        expect(result.os).toBe("Windows");
    });

    it("parses a mobile Safari/iOS user-agent", () => {
        const ua =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        const result = parseDeviceLabels(ua);
        expect(result.deviceType).toBe("mobile");
        expect(result.os).toBe("iOS");
    });
});
