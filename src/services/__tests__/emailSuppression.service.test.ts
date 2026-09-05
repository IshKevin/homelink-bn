import { isEmailSuppressed, suppressEmail } from "../emailSuppression.service";

describe("emailSuppression.service", () => {
    it("reports an address as not suppressed until it's been suppressed", async () => {
        const email = `check-${Date.now()}@example.com`;
        expect(await isEmailSuppressed(email)).toBe(false);

        await suppressEmail(email, "bounce", "General");
        expect(await isEmailSuppressed(email)).toBe(true);
    });

    it("is case-insensitive", async () => {
        const email = `Mixed-Case-${Date.now()}@Example.com`;
        await suppressEmail(email, "complaint");
        expect(await isEmailSuppressed(email.toLowerCase())).toBe(true);
        expect(await isEmailSuppressed(email.toUpperCase())).toBe(true);
    });

    it("updates the reason on a repeat suppression instead of erroring", async () => {
        const email = `repeat-${Date.now()}@example.com`;
        await suppressEmail(email, "bounce", "General");
        await suppressEmail(email, "complaint", "abuse");
        expect(await isEmailSuppressed(email)).toBe(true);
    });
});
