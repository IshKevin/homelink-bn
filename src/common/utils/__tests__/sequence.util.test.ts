import { nextDocumentNumber } from "../sequence.util";

describe("nextDocumentNumber", () => {
    it("formats sequential numbers with a year and zero-padded counter", async () => {
        const date = new Date("2026-03-15T00:00:00Z");
        const first = await nextDocumentNumber("ACC-INV", date);
        const second = await nextDocumentNumber("ACC-INV", date);

        expect(first).toBe("ACC-INV-2026-00001");
        expect(second).toBe("ACC-INV-2026-00002");
    });

    it("keeps separate counters per prefix and per year", async () => {
        const invoice2026 = await nextDocumentNumber("ACC-INV", new Date("2026-01-01T00:00:00Z"));
        const payment2026 = await nextDocumentNumber("ACC-PAY", new Date("2026-01-01T00:00:00Z"));
        const invoice2027 = await nextDocumentNumber("ACC-INV", new Date("2027-01-01T00:00:00Z"));

        expect(invoice2026).toBe("ACC-INV-2026-00001");
        expect(payment2026).toBe("ACC-PAY-2026-00001");
        expect(invoice2027).toBe("ACC-INV-2027-00001");
    });

    it("assigns distinct sequential values under concurrent calls", async () => {
        const date = new Date("2026-06-01T00:00:00Z");
        const results = await Promise.all(Array.from({ length: 10 }, () => nextDocumentNumber("ACC-PAY", date)));

        expect(new Set(results).size).toBe(10);
        expect(results.map((r) => Number(r.split("-")[3])).sort((a, b) => a - b)).toEqual(
            Array.from({ length: 10 }, (_, i) => i + 1)
        );
    });
});
