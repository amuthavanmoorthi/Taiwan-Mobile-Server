import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { router } from "./routes/index.js";
import { withSession } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { UPLOAD_DIR } from "./services/UploadService.js";

export function createApp() {
  const app = express();

  // The frontend runs on a different origin (and a LAN IP when testing on a
  // phone), so allow any origin in the demo. Lock this down for production.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(withSession);

  // Uploaded photos and 3D models.
  // Serve from wherever uploads are actually written. These were two
  // different paths the moment UPLOAD_DIR pointed at a mounted volume, so
  // every uploaded file 404'd while the writes themselves succeeded.
  app.use("/uploads", express.static(UPLOAD_DIR));

  app.use("/api", router);
  app.use(errorHandler);

  return app;
}
