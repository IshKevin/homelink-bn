import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../common/middlewares/auth.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { updateProfileSchema } from "./users.validation";
import {
    getMeHandler,
    getMyVerificationsHandler,
    submitVerificationHandler,
    updateMeHandler
} from "./users.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.use(authenticate);

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
