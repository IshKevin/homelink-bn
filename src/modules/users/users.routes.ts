import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { authorize } from "../../common/middlewares/rbac.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ADMIN_ROLES } from "../../common/constants/roles";
import { searchUsersSchema, updateProfileSchema } from "./users.validation";
import {
    getMeHandler,
    getMyVerificationsHandler,
    searchUsersHandler,
    submitVerificationHandler,
    updateMeHandler
} from "./users.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: Search the user directory (owner, agent, house manager, or admin) — e.g. to check whether a person already has an account before assigning them to a unit as a tenant
 *     parameters:
 *       - in: query
 *         name: search
 *         description: Matches first name, last name, email, or phone
 *         schema: { type: string }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [tenant, owner, agent, admin, superadmin, house_manager] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated list of matching users (id, name, email, phone, role, isActive only — not the full admin user record)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       403:
 *         description: Tenants cannot search the user directory
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/", authorize("owner", "agent", "house_manager", ...ADMIN_ROLES), validate(searchUsersSchema), searchUsersHandler);

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get my profile
 *     responses:
 *       200:
 *         description: Current user's profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   patch:
 *     tags: [Users]
 *     summary: Update my profile
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phone: { type: string }
 *               avatarUrl: { type: string }
 *               payoutMomoNumber: { type: string, description: "Landlord's MTN MoMo number for automated rent disbursements" }
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/me", getMeHandler);
router.patch("/me", validate(updateProfileSchema), updateMeHandler);

/**
 * @openapi
 * /users/me/verify-identity:
 *   post:
 *     tags: [Users]
 *     summary: Submit an identity verification document
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Verification submitted for admin review
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   get:
 *     tags: [Users]
 *     summary: View my identity verification submissions
 *     responses:
 *       200:
 *         description: List of my verification submissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/me/verify-identity", upload.single("document"), submitVerificationHandler);
router.get("/me/verify-identity", getMyVerificationsHandler);

export default router;
