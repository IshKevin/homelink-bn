import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import {
    createPropertySchema,
    createUnitSchema,
    generateUnitsSchema,
    listAvailableUnitsSchema,
    listPropertiesSchema,
    rejectPropertySchema,
    updatePropertySchema,
    updateUnitSchema
} from "./properties.validation";
import {
    addPropertyImagesHandler,
    approvePropertyHandler,
    createPropertyHandler,
    createUnitHandler,
    deletePropertyDocumentHandler,
    deletePropertyImageHandler,
    generateUnitsHandler,
    getPropertyDocumentHandler,
    getPropertyHandler,
    getUnitsImportTemplateHandler,
    importUnitsHandler,
    listAvailableUnitsHandler,
    listPropertiesHandler,
    listUnitsHandler,
    previewImportUnitsHandler,
    rejectPropertyHandler,
    setPropertyDocumentHandler,
    updatePropertyHandler,
    updateUnitHandler
} from "./properties.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * components:
 *   schemas:
 *     CreatePropertyInput:
 *       type: object
 *       required: [title, type, category, addressLine, city, country, rentAmount]
 *       properties:
 *         title: { type: string }
 *         description: { type: string }
 *         type: { type: string, enum: [apartment, house, studio, condo, commercial, other] }
 *         category: { type: string, enum: [residential, commercial], description: "commercial requires type=commercial and sizeSqm; residential type=apartment requires unitsCount" }
 *         sizeSqm: { type: number, description: "Required when category is commercial" }
 *         unitsCount: { type: integer, description: "Required when type is apartment (doors/units in the building)" }
 *         upi: { type: string, description: "Rwandan cadastral parcel ID, e.g. 1/01/03/02/1156" }
 *         terms: { type: array, items: { type: string }, example: ["12-month lease", "2 months deposit"] }
 *         attributes:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               label: { type: string }
 *               value: { type: string }
 *           example: [{ label: "Floor", value: "3rd Floor" }]
 *         addressLine: { type: string }
 *         city: { type: string }
 *         state: { type: string }
 *         country: { type: string }
 *         postalCode: { type: string }
 *         bedrooms: { type: number }
 *         bathrooms: { type: number }
 *         rentAmount: { type: number }
 *         rentConditions: { type: string }
 *         ownerId: { type: string, format: uuid, description: "Required when an agent or admin creates a property on behalf of an owner" }
 * /properties:
 *   post:
 *     tags: [Properties]
 *     summary: List a new property (owner, agent, or admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreatePropertyInput' }
 *     responses:
 *       201:
 *         description: Property created and pending admin approval
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid input, e.g. missing ownerId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       403:
 *         description: Tenants may not create properties
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   get:
 *     tags: [Properties]
 *     summary: List properties visible to the current user
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, occupied] }
 *       - in: query
 *         name: approvalStatus
 *         description: Admin-only in practice — other roles are already scoped to their own/approved properties.
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [apartment, house, studio, condo, commercial, other] }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [residential, commercial] }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: minRent
 *         schema: { type: number }
 *       - in: query
 *         name: maxRent
 *         schema: { type: number }
 *       - in: query
 *         name: ownerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of properties
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 */
router.post(
    "/",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(createPropertySchema),
    createPropertyHandler
);
router.get("/", validate(listPropertiesSchema), listPropertiesHandler);

/**
 * @openapi
 * /properties/units:
 *   get:
 *     tags: [Properties]
 *     summary: Search units available for assignment across the caller's own properties (owner/agent/house_manager) or all properties (admin)
 *     description: Registered before GET /properties/{id} so "units" isn't matched as a property id. Not available to tenants.
 *     parameters:
 *       - in: query
 *         name: search
 *         description: Matches unit label or property title
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, occupied] }
 *       - in: query
 *         name: propertyId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Matching units, each with its parent property's title/address embedded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to search units
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/units", validate(listAvailableUnitsSchema), listAvailableUnitsHandler);

/**
 * @openapi
 * /properties/units/import-template:
 *   get:
 *     tags: [Properties]
 *     summary: Download a starter .xlsx template for importing units (see POST /properties/{id}/units/import)
 *     responses:
 *       200:
 *         description: Binary xlsx template
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get("/units/import-template", getUnitsImportTemplateHandler);

/**
 * @openapi
 * /properties/{id}:
 *   patch:
 *     tags: [Properties]
 *     summary: Update a property (owner of the property, its assigned agent, or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any subset of the property's editable fields
 *     responses:
 *       200:
 *         description: Property updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: You do not have permission to modify this property
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       404:
 *         description: Property not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   get:
 *     tags: [Properties]
 *     summary: Get a single property's details and images
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Property details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Property not found or not visible to the caller
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/:id",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(updatePropertySchema),
    updatePropertyHandler
);
router.get("/:id", getPropertyHandler);

/**
 * @openapi
 * /properties/{id}/images:
 *   post:
 *     tags: [Properties]
 *     summary: Upload images for a property
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Images uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: At least one image is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post(
    "/:id/images",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    upload.array("images", 10),
    addPropertyImagesHandler
);

/**
 * @openapi
 * /properties/{id}/images/{imageId}:
 *   delete:
 *     tags: [Properties]
 *     summary: Delete a property image
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Image deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Image not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.delete(
    "/:id/images/:imageId",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    deletePropertyImageHandler
);

/**
 * @openapi
 * /properties/{id}/units:
 *   post:
 *     tags: [Properties]
 *     summary: Add a unit to a property (owner, assigned agent, house manager, or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, rentAmount]
 *             properties:
 *               label: { type: string }
 *               bedrooms: { type: number }
 *               bathrooms: { type: number }
 *               rentAmount: { type: number }
 *     responses:
 *       201:
 *         description: Unit created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   get:
 *     tags: [Properties]
 *     summary: List a property's units
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of units
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post(
    "/:id/units",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(createUnitSchema),
    createUnitHandler
);
router.get("/:id/units", listUnitsHandler);

/**
 * @openapi
 * /properties/{id}/units/generate:
 *   post:
 *     tags: [Properties]
 *     summary: Bulk-create units with a shared default price (e.g. for an apartment/commercial building) — owner/agent/house_manager/admin only
 *     description: Individual unit prices are edited afterward via PATCH /properties/{id}/units/{unitId}. See also /units/import for per-unit pricing at creation time.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [count, rentAmount]
 *             properties:
 *               count: { type: integer, minimum: 1, maximum: 500 }
 *               floors: { type: integer, minimum: 1, maximum: 500, description: "If given, units are distributed evenly and labeled 'Floor N - Unit M'" }
 *               bedrooms: { type: number }
 *               bathrooms: { type: number }
 *               rentAmount: { type: number }
 *     responses:
 *       201:
 *         description: Units created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post(
    "/:id/units/generate",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(generateUnitsSchema),
    generateUnitsHandler
);

/**
 * @openapi
 * /properties/{id}/units/import/preview:
 *   post:
 *     tags: [Properties]
 *     summary: Parse and validate an uploaded .xlsx file WITHOUT creating anything, for a confirm-before-import preview
 *     description: Same validation as POST /units/import (including duplicate unit-number detection, both within the file and against the property's existing units). Confirming re-submits the same file to /units/import.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: "{ values: unit rows that would be created, errors: { row, message }[] }"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post(
    "/:id/units/import/preview",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    upload.single("file"),
    previewImportUnitsHandler
);

/**
 * @openapi
 * /properties/{id}/units/import:
 *   post:
 *     tags: [Properties]
 *     summary: Bulk-create units from an uploaded .xlsx file, one row per unit — owner/agent/house_manager/admin only
 *     description: Header row (case-insensitive) columns - label (or "unit number"/"unit name"), unitType, floor, bedrooms, bathrooms, rentAmount, deposit, description, status. All-or-nothing - if any row is invalid (including a duplicate unit number), nothing is imported and the row errors are returned.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Units imported
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: The file is missing, empty, or has invalid rows
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post(
    "/:id/units/import",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    upload.single("file"),
    importUnitsHandler
);

/**
 * @openapi
 * /properties/{id}/units/{unitId}:
 *   patch:
 *     tags: [Properties]
 *     summary: Update a property's unit
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: unitId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any subset of label, bedrooms, bathrooms, rentAmount
 *     responses:
 *       200:
 *         description: Unit updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.patch(
    "/:id/units/:unitId",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(updateUnitSchema),
    updateUnitHandler
);

/**
 * @openapi
 * /properties/{id}/document:
 *   put:
 *     tags: [Properties]
 *     summary: Upload (or replace) a property's document, e.g. title deed
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Document uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   get:
 *     tags: [Properties]
 *     summary: Get a presigned URL for the property's document
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Presigned URL
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: This property has no document
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   delete:
 *     tags: [Properties]
 *     summary: Delete the property's document
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Document deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.put(
    "/:id/document",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    upload.single("document"),
    setPropertyDocumentHandler
);
router.get("/:id/document", getPropertyDocumentHandler);
router.delete(
    "/:id/document",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    deletePropertyDocumentHandler
);

/**
 * @openapi
 * /properties/{id}/approve:
 *   patch:
 *     tags: [Properties]
 *     summary: Approve a pending property listing (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Property approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Property not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/:id/approve", authorize(...ADMIN_ROLES), approvePropertyHandler);

/**
 * @openapi
 * /properties/{id}/reject:
 *   patch:
 *     tags: [Properties]
 *     summary: Reject a pending property listing (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rejectionReason]
 *             properties:
 *               rejectionReason: { type: string }
 *     responses:
 *       200:
 *         description: Property rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: rejectionReason is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch("/:id/reject", authorize(...ADMIN_ROLES), validate(rejectPropertySchema), rejectPropertyHandler);

export default router;
