import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { buildExcelBuffer } from "../../services/excel.service";
import { renderHtmlToPdf } from "../../services/pdf.service";
import * as dashboardService from "./dashboard.service";

export async function getOwnerDashboardHandler(req: Request, res: Response) {
    const data = await dashboardService.getOwnerDashboard(req.user!.id);
    return sendSuccess(res, { data });
}

export async function getAdminDashboardHandler(req: Request, res: Response) {
    const data = await dashboardService.getAdminDashboard();
    return sendSuccess(res, { data });
}

export async function getStatementHandler(req: Request, res: Response) {
    const query = req.query as { from?: string; to?: string; format?: "json" | "excel" | "pdf" };
    const statement = await dashboardService.getProfitLossStatement(query.from, query.to);

    if (query.format === "excel") {
        const rows = dashboardService.buildStatementRows(statement);
        const buffer = await buildExcelBuffer(
            "Profit & Loss",
            [
                { header: "Metric", key: "Metric" },
                { header: "Value", key: "Value" }
            ],
            rows
        );
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="statement.xlsx"');
        return res.send(buffer);
    }

    if (query.format === "pdf") {
        const html = dashboardService.buildStatementHtml(statement);
        const buffer = await renderHtmlToPdf(html);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'attachment; filename="statement.pdf"');
        return res.send(buffer);
    }

    return sendSuccess(res, { data: statement });
}
