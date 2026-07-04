import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
    res.json({
        status: "ok",
        message: "HomeLink API is running"
    });
});

export default router;