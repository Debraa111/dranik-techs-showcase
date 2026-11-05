import type { Request, Response } from "express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  user: User | null;
  req: Request;
  res: Response;
};

export async function createContext({ req, res }: { req: Request; res: Response }): Promise<TrpcContext> {
  const user = await sdk.authenticateRequest(req).catch(() => null);
  return { user, req, res };
}
