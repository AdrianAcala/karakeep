import { headers } from "next/headers";
import { getServerAuthSession } from "@/server/auth";
import { and, eq, isNull } from "drizzle-orm";
import requestIp from "request-ip";

import { db } from "@karakeep/db";
import { users } from "@karakeep/db/schema";
import { Context, createCallerFactory } from "@karakeep/trpc";
import { authenticateApiKey } from "@karakeep/trpc/auth";
import { appRouter } from "@karakeep/trpc/routers/_app";

export async function createContextFromRequest(req: Request) {
  // TODO: This is a hack until we offer a proper REST API instead of the trpc based one.
  // Check if the request has an Authorization token, if it does, assume that API key authentication is requested.
  const ip = requestIp.getClientIp({
    headers: Object.fromEntries(req.headers.entries()),
  });
  const authorizationHeader = req.headers.get("Authorization");
  if (authorizationHeader && authorizationHeader.startsWith("Bearer ")) {
    const token = authorizationHeader.split(" ")[1];
    try {
      const authResult = await authenticateApiKey(token, db);
      return {
        user: authResult.user,
        auth: {
          type: "apiKey" as const,
          keyId: authResult.apiKey.keyId,
          scopes: authResult.apiKey.scopes,
        },
        db,
        req: {
          ip,
        },
      };
    } catch {
      // Fallthrough to cookie-based auth
    }
  }

  return createContext(db, ip);
}

export const createContext = async (
  database?: typeof db,
  ip?: string | null,
): Promise<Context> => {
  const session = await getServerAuthSession();
  if (ip === undefined) {
    const hdrs = await headers();
    ip = requestIp.getClientIp({
      headers: Object.fromEntries(hdrs.entries()),
    });
  }
  const activeUser = session?.user?.id
    ? await (database ?? db).query.users.findFirst({
        where: and(eq(users.id, session.user.id), isNull(users.deletedAt)),
      })
    : null;
  return {
    user: activeUser
      ? {
          id: activeUser.id,
          name: activeUser.name,
          email: activeUser.email,
          role: activeUser.role,
        }
      : null,
    auth: activeUser
      ? {
          type: "session" as const,
        }
      : null,
    db: database ?? db,
    req: {
      ip,
    },
  };
};

const createCaller = createCallerFactory(appRouter);

export const api = createCaller(createContext);

export const createTrcpClientFromCtx = createCaller;
