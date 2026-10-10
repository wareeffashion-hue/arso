import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

/** X-Request-ID (القسم 42): نقبل معرّف العميل إن كان آمنًا، وإلا نولّد واحدًا */
export function requestId(
  req: Request & { requestId?: string },
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-request-id');
  const id = incoming && VALID.test(incoming) ? incoming : `req_${randomUUID()}`;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}
