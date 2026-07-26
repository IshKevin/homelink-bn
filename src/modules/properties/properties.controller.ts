import type { Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";
import { sendSuccess } from "../../common/utils/response.util";
import { buildPaginationMeta, getPagination } from "../../common/utils/pagination.util";
import * as propertiesService from "./properties.service";

export async function createPropertyHandler(req: Request, res: Response) {
    const property = await propertiesService.createProperty(req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Property created", data: property });
}

export async function updatePropertyHandler(req: Request, res: Response) {
    const property = await propertiesService.updateProperty(req.params["id"] as string, req.user!, req.body);
    return sendSuccess(res, { message: "Property updated", data: property });
}

export async function listPropertiesHandler(req: Request, res: Response) {
    const { page, limit, offset } = getPagination(req);
    const query = req.query as {
        status?: "available" | "occupied";
        type?: "apartment" | "house" | "studio" | "condo" | "commercial" | "other";
        category?: "residential" | "commercial";
        city?: string;
        minRent?: number;
        maxRent?: number;
        ownerId?: string;
    };

    const { rows, total } = await propertiesService.listProperties(
        req.user!,
        {
            status: query.status,
            type: query.type,
            category: query.category,
            city: query.city,
            minRent: query.minRent,
            maxRent: query.maxRent,
            ownerId: query.ownerId
        },
        { limit, offset }
    );

    return sendSuccess(res, { data: rows, meta: buildPaginationMeta(page, limit, total) });
}

export async function getPropertyHandler(req: Request, res: Response) {
    const property = await propertiesService.getPropertyById(req.params["id"] as string, req.user!);
    return sendSuccess(res, { data: property });
}

export async function addPropertyImagesHandler(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
        throw AppError.badRequest("At least one image is required");
    }
    const images = await propertiesService.addPropertyImages(req.params["id"] as string, req.user!, files);
    return sendSuccess(res, { statusCode: 201, message: "Images uploaded", data: images });
}

export async function deletePropertyImageHandler(req: Request, res: Response) {
    await propertiesService.deletePropertyImage(req.params["id"] as string, req.params["imageId"] as string, req.user!);
    return sendSuccess(res, { message: "Image deleted" });
}

export async function createUnitHandler(req: Request, res: Response) {
    const unit = await propertiesService.createUnit(req.params["id"] as string, req.user!, req.body);
    return sendSuccess(res, { statusCode: 201, message: "Unit created", data: unit });
}

export async function listUnitsHandler(req: Request, res: Response) {
    const units = await propertiesService.listUnits(req.params["id"] as string);
    return sendSuccess(res, { data: units });
}

export async function updateUnitHandler(req: Request, res: Response) {
    const unit = await propertiesService.updateUnit(
        req.params["id"] as string,
        req.params["unitId"] as string,
        req.user!,
        req.body
    );
    return sendSuccess(res, { message: "Unit updated", data: unit });
}

export async function setPropertyDocumentHandler(req: Request, res: Response) {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw AppError.badRequest("A document file is required");
    const property = await propertiesService.setPropertyDocument(req.params["id"] as string, req.user!, file);
    return sendSuccess(res, { message: "Document uploaded", data: property });
}

export async function getPropertyDocumentHandler(req: Request, res: Response) {
    const document = await propertiesService.getPropertyDocument(req.params["id"] as string);
    return sendSuccess(res, { data: document });
}

export async function deletePropertyDocumentHandler(req: Request, res: Response) {
    await propertiesService.deletePropertyDocument(req.params["id"] as string, req.user!);
    return sendSuccess(res, { message: "Document deleted" });
}

export async function approvePropertyHandler(req: Request, res: Response) {
    const property = await propertiesService.approveProperty(req.params["id"] as string, req.user!);
    return sendSuccess(res, { message: "Property approved", data: property });
}

export async function rejectPropertyHandler(req: Request, res: Response) {
    const property = await propertiesService.rejectProperty(req.params["id"] as string, req.user!, req.body.rejectionReason);
    return sendSuccess(res, { message: "Property rejected", data: property });
}
