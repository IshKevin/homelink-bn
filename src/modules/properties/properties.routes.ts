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
    updateFloorSchema,
    updatePropertySchema,
    updateUnitSchema
} from "./properties.validation";
import {
    addPropertyImagesHandler,
    approvePropertyHandler,
    createPropertyHandler,
    createUnitHandler,
    deletePropertyDocumentHandler,
    deletePropertyHandler,
    deletePropertyImageHandler,
    deleteUnitHandler,
    generateUnitsHandler,
    getPropertyDocumentHandler,
    getPropertyHandler,
    getUnitHandler,
    getUnitsImportTemplateHandler,
    importUnitsHandler,
    listAvailableUnitsHandler,
    listFloorsHandler,
    listPropertiesHandler,
    listUnitsByFloorHandler,
    listUnitsHandler,
    previewImportUnitsHandler,
    rejectPropertyHandler,
    setPropertyDocumentHandler,
    updateFloorHandler,
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
 *       required: [title, type, location, numberOfFloors]
 *       properties:
 *         title: { type: string, description: "Property name" }
 *         type: { type: string, enum: [apartment, house, studio, condo, commercial, other] }
 *         location: { type: string, description: "Free-text address/location" }
 *         numberOfFloors: { type: integer, minimum: 1, maximum: 200, description: "Auto-creates this many floors (Ground, Floor 1, Floor 2, ...) — units are added afterward per floor via the floor endpoints below" }
 *         ownerId: { type: string, format: uuid, description: "Required when an agent or admin creates a property on behalf of an owner" }
 *     UpdatePropertyInput:
 *       type: object
 *       description: Any subset of these fields — at least one is required. numberOfFloors is not editable here; manage floors individually instead.
 *       properties:
 *         title: { type: string }
 *         type: { type: string, enum: [apartment, house, studio, condo, commercial, other] }
 *         location: { type: string }
 *         status: { type: string, enum: [available, occupied], description: "Direct status edits only toggle between available/occupied; this is normally recomputed automatically from unit occupancy." }
 *     Floor:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         propertyId: { type: string, format: uuid }
 *         name: { type: string, example: "Ground" }
 *         scale: { type: number, nullable: true, description: "Floor size/area — set via PATCH, null until then" }
 *         index: { type: integer, description: "0 = Ground, 1+ = Floor N" }
 *         unitsCount: { type: integer, description: "Computed — number of non-archived units on this floor" }
 * /properties:
 *   post:
 *     tags: [Properties]
 *     summary: Register a new property (owner, agent, or admin)
 *     description: Creates the property and auto-generates its floors from numberOfFloors — no units yet. Add units via POST /properties/{id}/units or /units/generate, scoped to one of these floors.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreatePropertyInput' }
 *     responses:
 *       201:
 *         description: Property created (pending admin approval) with its floors auto-generated
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
 *       409:
 *         description: An identical property (same owner/title/location) was just created — likely a double-submit
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
 *         name: search
 *         description: Matches title or location
 *         schema: { type: string }
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
 *         description: Defaults to "available" — maintenance/inactive units are excluded from this search unless explicitly requested
 *         schema: { type: string, enum: [available, occupied, maintenance, inactive] }
 *       - in: query
 *         name: propertyId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Matching units, each with its parent property's title/location embedded
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
 *           schema: { $ref: '#/components/schemas/UpdatePropertyInput' }
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
 *         description: Property details, with its (non-archived) units embedded and counted
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
 * /properties/{id}:
 *   delete:
 *     tags: [Properties]
 *     summary: Permanently delete a property (owner, house manager, or admin) — only if it has no lease history
 *     description: >
 *       Deliberately narrow: for cleaning up a genuine accidental duplicate
 *       (e.g. a double-submitted create), not for removing a property with
 *       real history. Blocked (409) if any lease — even a terminated or
 *       rejected one — has ever been created against this property; use
 *       deactivate instead in that case.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Property deleted
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
 *       409:
 *         description: Property has lease history and cannot be deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.delete("/:id", authorize("owner", "agent", "house_manager", ...ADMIN_ROLES), deletePropertyHandler);

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
 * /properties/{id}/floors:
 *   get:
 *     tags: [Properties]
 *     summary: List a property's floors (readable by a tenant with a lease on this property too, same rule as units)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Floors in index order, each with a computed unitsCount
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/:id/floors", listFloorsHandler);

/**
 * @openapi
 * /properties/{id}/floors/{floorId}:
 *   patch:
 *     tags: [Properties]
 *     summary: Edit a floor's name and/or scale (size/area) — owner, assigned agent, house manager, or admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: floorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any subset of name, scale
 *             properties:
 *               name: { type: string }
 *               scale: { type: number }
 *     responses:
 *       200:
 *         description: Floor updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Floor not found on this property
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.patch(
    "/:id/floors/:floorId",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(updateFloorSchema),
    updateFloorHandler
);

/**
 * @openapi
 * /properties/{id}/floors/{floorId}/units:
 *   get:
 *     tags: [Properties]
 *     summary: List one floor's units
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: floorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Units on this floor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Floor not found on this property
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id/floors/:floorId/units", listUnitsByFloorHandler);

/**
 * @openapi
 * /properties/{id}/units:
 *   post:
 *     tags: [Properties]
 *     summary: Add a single unit to one of a property's floors (owner, assigned agent, house manager, or admin)
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
 *             required: [label, floorId, rentAmount]
 *             properties:
 *               label: { type: string }
 *               floorId: { type: string, format: uuid }
 *               unitType: { type: string, example: "1-bedroom" }
 *               description: { type: string }
 *               bedrooms: { type: number }
 *               bathrooms: { type: number }
 *               rentAmount: { type: number }
 *               deposit: { type: number }
 *     responses:
 *       201:
 *         description: Unit created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Floor not found on this property
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *   get:
 *     tags: [Properties]
 *     summary: List a property's units across all floors
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
 *     summary: Bulk-create units on one floor with a shared default price — owner/agent/house_manager/admin only
 *     description: Called once per floor (e.g. Ground=7, Floor 1=10, Floor 2=8 — three separate calls). Units are labeled "{Floor name} - Unit N". Individual unit prices are edited afterward via PATCH /properties/{id}/units/{unitId}. See also /units/import for per-unit pricing at creation time.
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
 *             required: [floorId, count, rentAmount]
 *             properties:
 *               floorId: { type: string, format: uuid }
 *               count: { type: integer, minimum: 1, maximum: 500 }
 *               unitType: { type: string, example: "1-bedroom" }
 *               bedrooms: { type: number }
 *               bathrooms: { type: number }
 *               rentAmount: { type: number }
 *               deposit: { type: number }
 *     responses:
 *       201:
 *         description: Units created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Floor not found on this property
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
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
 *     description: Same validation as POST /units/import (including duplicate unit-number detection, both within the file and against the property's existing units, and that each row's Floor name matches an existing floor). Confirming re-submits the same file to /units/import.
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
 *     description: Header row (case-insensitive) columns - label (or "unit number"/"unit name"), unitType, floor (must match an existing floor's name, e.g. "Ground"), bedrooms, bathrooms, rentAmount, deposit, description, status. All-or-nothing - if any row is invalid (including an unrecognized floor name or a duplicate unit number), nothing is imported and the row errors are returned.
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
 *   get:
 *     tags: [Properties]
 *     summary: Get a single unit's details, its floor, and its current lease/tenant if occupied
 *     description: Payment, maintenance/expense, and lease-history (previous tenants) data live behind their own unitId-filtered endpoints (GET /payments?unitId=, GET /maintenance-requests?unitId=, GET /leases?unitId=) rather than being inlined here.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: unitId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Unit detail
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
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
 *             description: Any subset of label, floorId, unitType, description, bedrooms, bathrooms, rentAmount, deposit, status
 *             properties:
 *               label: { type: string }
 *               floorId: { type: string, format: uuid, description: "Move the unit to a different floor on the same property" }
 *               unitType: { type: string }
 *               description: { type: string }
 *               bedrooms: { type: number }
 *               bathrooms: { type: number }
 *               rentAmount: { type: number }
 *               deposit: { type: number }
 *               status:
 *                 type: string
 *                 enum: [available, maintenance, inactive]
 *                 description: "occupied is set only by lease assignment/vacancy, never directly; rejected if the unit currently has an active lease"
 *     responses:
 *       200:
 *         description: Unit updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/:id/units/:unitId", getUnitHandler);
router.patch(
    "/:id/units/:unitId",
    authorize("owner", "agent", "house_manager", ...ADMIN_ROLES),
    validate(updateUnitSchema),
    updateUnitHandler
);

/**
 * @openapi
 * /properties/{id}/units/{unitId}:
 *   delete:
 *     tags: [Properties]
 *     summary: Delete (archive) a property's unit (owner, assigned agent, house manager, or admin)
 *     description: Soft-delete — the unit disappears from the property's unit list and available-units search, but its row and any lease/invoice/payment history tied to it are kept, exactly like a terminated lease. Its unit number becomes free to reuse on a new unit.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: unitId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Unit archived
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Unit currently has an active tenant — end that lease first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.delete("/:id/units/:unitId", authorize("owner", "agent", "house_manager", ...ADMIN_ROLES), deleteUnitHandler);

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
