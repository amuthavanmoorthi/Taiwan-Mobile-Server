import express from "express";
import { join } from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import { router } from "./routes/index.js";
import { withSession } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  // The frontend runs on a different origin (and a LAN IP when testing on a
  // phone), so allow any origin in the demo. Lock this down for production.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(withSession);

  // Uploaded photos and 3D models.
  app.use("/uploads", express.static(join(process.cwd(), "uploads")));

  app.use("/api", router);
  app.use(errorHandler);

  return app;
}
