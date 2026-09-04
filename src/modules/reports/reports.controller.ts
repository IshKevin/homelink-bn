import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util";
import { buildExcelBuffer } from "../../services/excel.service";
import * as reportsService from "./reports.service";

type ReportQuery = { from?: string; to?: string; format?: "json" | "excel" };

async function respondWithReport(
    req: Request,
    res: Response,
    result: reportsService.ReportResult,
    sheetName: string,
    filename: string
) {
    const query = req.query as ReportQuery;

    if (query.format === "excel") {
        const buffer = await buildExcelBuffer(sheetName, result.columns, result.rows);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
    }

    return sendSuccess(res, { data: { summary: result.summary, rows: result.rows } });
}

export async function getRentalHistoryHandler(req: Request, res: Response) {
    const query = req.query as ReportQuery;
    const result = await reportsService.getRentalHistoryReport(req.user!, { from: query.from, to: query.to });
    return respondWithReport(req, res, result, "Rental History", "rental-history.xlsx");
}

export async function getPaymentHistoryHandler(req: Request, res: Response) {
    const query = req.query as ReportQuery;
    const result = await reportsService.getPaymentHistoryReport(req.user!, { from: query.from, to: query.to });
    return respondWithReport(req, res, result, "Payment History", "payment-history.xlsx");
}

export async function getOccupancyHandler(req: Request, res: Response) {
    const query = req.query as ReportQuery;
    const result = await reportsService.getOccupancyReport(req.user!, { from: query.from, to: query.to });
    return respondWithReport(req, res, result, "Occupancy", "occupancy.xlsx");
}

export async function getMaintenanceActivityHandler(req: Request, res: Response) {
    const query = req.query as ReportQuery;
    const result = await reportsService.getMaintenanceActivityReport(req.user!, { from: query.from, to: query.to });
    return respondWithReport(req, res, result, "Maintenance Activity", "maintenance-activity.xlsx");
}

export async function getRevenuePerformanceHandler(req: Request, res: Response) {
    const query = req.query as ReportQuery;
    const result = await reportsService.getRevenuePerformanceReport(req.user!, { from: query.from, to: query.to });
    return respondWithReport(req, res, result, "Revenue Performance", "revenue-performance.xlsx");
}

export async function getAgentPerformanceHandler(req: Request, res: Response) {
    const query = req.query as ReportQuery;
    const result = await reportsService.getAgentPerformanceReport(req.user!, { from: query.from, to: query.to });
    return respondWithReport(req, res, result, "Agent Performance", "agent-performance.xlsx");
}

export async function getLandlordPerformanceHandler(req: Request, res: Response) {
    const result = await reportsService.getLandlordPerformanceReport(req.user!);
    return respondWithReport(req, res, result, "Landlord Performance", "landlord-performance.xlsx");
}
