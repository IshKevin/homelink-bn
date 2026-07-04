import { Router } from "express";
import { validate } from "../../common/middlewares/validate.middleware";
import { authRateLimiter } from "../../common/middlewares/rateLimiter.middleware";
import {
    forgotPasswordSchema,
    loginSchema,
    refreshSchema,
    registerSchema,
    resetPasswordSchema
} from "./auth.validation";
import {
    forgotPasswordHandler,
    loginHandler,
    logoutHandler,
    refreshHandler,
    registerHandler,
    resetPasswordHandler
} from "./auth.controller";

const router = Router();

router.use(authRateLimiter);

/**
 * @openapi
 * components:
 *   schemas:
 *     RegisterInput:
 *       type: object
 *       required: [email, password, firstName, lastName, role]
 *       properties:
 *         email: { type: string, format: email }
 *         password: { type: string, format: password, minLength: 8 }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         phone: { type: string }
 *         role: { type: string, enum: [tenant, owner, agent] }
 *     AuthTokens:
 *       type: object
 *       properties:
 *         accessToken: { type: string }
 *         refreshToken: { type: string }
 *         user: { type: object }
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register as a tenant, property owner, or agent
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RegisterInput' }
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Email already in use
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/register", validate(registerSchema), registerHandler);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/login", validate(loginSchema), loginHandler);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access/refresh token pair
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Token refreshed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Invalid or expired refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/refresh", validate(refreshSchema), refreshHandler);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out and revoke the given refresh token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/logout", validate(refreshSchema), logoutHandler);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset link by email
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Reset link sent if the email exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPasswordHandler);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using a token from the forgot-password email
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/reset-password", validate(resetPasswordSchema), resetPasswordHandler);

export default router;
