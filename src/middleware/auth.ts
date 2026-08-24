import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

export type Session = { sub: string; role: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

/** Reads the bearer token if present, but does not require it. */
export function withSession(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const payload = verifyToken<Session>(token);
  if (payload) req.session = { sub: payload.sub, role: payload.role };
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session) return next(new HttpError("Sign in required.", 401));
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.session) return next(new HttpError("Sign in required.", 401));
    if (!roles.includes(req.session.role)) {
      return next(new HttpError("You do not have access to this area.", 403));
    }
    next();
  };
}
