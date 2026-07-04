import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { createPropertySchema, listPropertiesSchema, rejectPropertySchema, updatePropertySchema } from "./properties.validation";
import {
    addPropertyImagesHandler,
    approvePropertyHandler,
    createPropertyHandler,
    deletePropertyImageHandler,
    getPropertyHandler,
    listPropertiesHandler,
    rejectPropertyHandler,
    updatePropertyHandler
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
 *       required: [title, type, addressLine, city, country, rentAmount]
 *       properties:
 *         title: { type: string }
 *         description: { type: string }
 *         type: { type: string, enum: [apartment, house, studio, condo, commercial, other] }
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
 *         name: type
 *         schema: { type: string, enum: [apartment, house, studio, condo, commercial, other] }
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
router.post("/", authorize("owner", "agent", "admin"), validate(createPropertySchema), createPropertyHandler);
router.get("/", validate(listPropertiesSchema), listPropertiesHandler);

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
router.patch("/:id", authorize("owner", "agent", "admin"), validate(updatePropertySchema), updatePropertyHandler);
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
router.post("/:id/images", authorize("owner", "agent", "admin"), upload.array("images", 10), addPropertyImagesHandler);

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
router.delete("/:id/images/:imageId", authorize("owner", "agent", "admin"), deletePropertyImageHandler);

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
router.patch("/:id/approve", authorize("admin"), approvePropertyHandler);

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
router.patch("/:id/reject", authorize("admin"), validate(rejectPropertySchema), rejectPropertyHandler);

export default router;
