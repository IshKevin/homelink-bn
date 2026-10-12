// TypeScript compiles to CommonJS (tsconfig "module": "commonjs"), which
// downlevels even `await import(...)` into a `require()` call — that can
// never load puppeteer 22+, which dropped CJS and ships ESM-only. Routing
// through `Function` keeps this one specifier as a real runtime
// `import()`, invisible to that downleveling, which is the standard
// workaround for loading an ESM-only package from CommonJS.
const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("puppeteer")>;

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
    const { default: puppeteer } = await dynamicImport("puppeteer");
    const browser = await puppeteer.launch({
        headless: true,
        ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" } });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}
