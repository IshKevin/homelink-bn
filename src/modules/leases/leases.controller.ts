import type { Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";
import { sendSuccess } from "../../common/utils/response.util";
import { buildPaginationMeta, getPagination } from "../../common/utils/pagination.util";
import * as leasesService from "./leases.service";

export async function createLeaseHandler(req: Request, res: Response) {
    const lease = await leasesService.createLease(req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Lease created", data: lease });
}

export async function listLeasesHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        status?:
            | "draft"
            | "pending_signatures"
            | "active"
            | "pending_renewal"
            | "pending_termination"
            | "terminated"
            | "expired";
    };

    const { rows, total } = await leasesService.listLeases(req.user!, { status: query.status }, { limit, offset });

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function getLeaseHandler(req: Request, res: Response) {
    const lease = await leasesService.getLeaseById(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: lease });
}

export async function signLeaseHandler(req: Request, res: Response) {
    const lease = await leasesService.signLease(req.params["id"] as string, req.user!);
    return sendSuccess(res, { message: "Lease signed", data: lease });
}

export async function getLeaseDocumentHandler(req: Request, res: Response) {
    const result = await leasesService.getLeaseDocument(req.params["id"] as string, req.user!);
    if (result.type === "url") {
        return sendSuccess(res, { data: { url: result.url } });
    }
    res.setHeader("Content-Type", "application/pdf");
    return res.send(result.buffer);
}

export async function requestRenewalHandler(req: Request, res: Response) {
    const changeRequest = await leasesService.requestRenewal(req.params["id"] as string, req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Renewal requested", data: changeRequest });
}

export async function requestTerminationHandler(req: Request, res: Response) {
    const changeRequest = await leasesService.requestTermination(req.params["id"] as string, req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Termination requested", data: changeRequest });
}

export async function listChangeRequestsHandler(req: Request, res: Response) {
    const changeRequests = await leasesService.listChangeRequests(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: changeRequests });
}

export async function approveChangeRequestHandler(req: Request, res: Response) {
    const changeRequest = await leasesService.decideChangeRequest(req.params["id"] as string, req.user!, "approved");
    return sendSuccess(res, { message: "Change request approved", data: changeRequest });
}

export async function rejectChangeRequestHandler(req: Request, res: Response) {
    const changeRequest = await leasesService.decideChangeRequest(
        req.params["id"] as string,
        req.user!,
        "rejected",
        req.body.decisionNotes
    );
    return sendSuccess(res, { message: "Change request rejected", data: changeRequest });
}

export async function createMoveRequestHandler(req: Request, res: Response) {
    const moveRequest = await leasesService.createMoveRequest(req.params["id"] as string, req.user!, req.body.type);
    return sendSuccess(res, { statusCode: 201, message: "Move-out request created", data: moveRequest });
}

export async function listMoveRequestsHandler(req: Request, res: Response) {
    const moveRequests = await leasesService.listMoveRequests(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: moveRequests });
}

export async function updateMoveRequestChecklistHandler(req: Request, res: Response) {
    const moveRequest = await leasesService.updateMoveRequestChecklist(
        req.params["id"] as string,
        req.user!,
        req.body.checklist
    );
    return sendSuccess(res, { message: "Checklist updated", data: moveRequest });
}

export async function inspectMoveRequestHandler(req: Request, res: Response) {
    const moveRequest = await leasesService.inspectMoveRequest(
        req.params["id"] as string,
        req.user!,
        req.body.inspectionNotes
    );
    return sendSuccess(res, { message: "Move request inspected", data: moveRequest });
}

export async function addLeaseDocumentsHandler(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
        throw AppError.badRequest("At least one document is required");
    }
    const documents = await leasesService.addLeaseDocuments(req.params["id"] as string, req.user!, files);
    return sendSuccess(res, { statusCode: 201, message: "Documents uploaded", data: documents });
}

export async function listLeaseDocumentsHandler(req: Request, res: Response) {
    const documents = await leasesService.listLeaseDocuments(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: documents });
}

export async function deleteLeaseDocumentHandler(req: Request, res: Response) {
    await leasesService.deleteLeaseDocument(req.params["id"] as string, req.params["documentId"] as string, req.user!);
    return sendSuccess(res, { message: "Document deleted" });
}

export async function confirmLeaseDocumentsHandler(req: Request, res: Response) {
    const lease = await leasesService.confirmLeaseDocuments(req.params["id"] as string, req.user!);
    return sendSuccess(res, { message: "Lease documents confirmed", data: lease });
}
