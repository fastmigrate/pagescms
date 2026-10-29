import { toErrorResponse } from "@/lib/api-error";
import { readCollectionOrder, saveCollectionOrder } from "@/lib/github-collection-order";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { assertFileWriteOrigin, readFileRequest } from "@/lib/upload-limits";

type Context = { params: Promise<{ owner: string; repo: string; branch: string; name: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const session = await requireApiUserSession();
    if ("response" in session) return session.response;
    const { token } = await getToken(session.user, params.owner, params.repo, true);
    const data = await readCollectionOrder({ ...params, token });
    return Response.json({ status: "success", data });
  } catch (error) {
    console.error(error);
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertFileWriteOrigin(request);
    const params = await context.params;
    const session = await requireApiUserSession();
    if ("response" in session) return session.response;
    const { token } = await getToken(session.user, params.owner, params.repo, true);
    const input: unknown = await readFileRequest(request);
    const data = await saveCollectionOrder({ ...params, token, user: session.user }, input);
    return Response.json({ status: "success", data });
  } catch (error) {
    console.error(error);
    return toErrorResponse(error);
  }
}
