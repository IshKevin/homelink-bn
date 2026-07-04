import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";

import routes from "./routes";

const app = express();

// Security middlewares
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Routes
app.use("/api/v1", routes);

export default app;