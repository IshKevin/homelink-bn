export async function renderHtmlToPdf(html: string): Promise<Buffer> {
    const { default: puppeteer } = await import("puppeteer");
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
