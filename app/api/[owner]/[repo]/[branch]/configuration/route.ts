import { getRepoReadContext } from "@/lib/api-repo-context";
import { toErrorResponse } from "@/lib/api-error";

export async function GET(_request: Request, context: {
  params: Promise<{ owner: string; repo: string; branch: string }>;
}) {
  try {
    const params = await context.params;
    const { config } = await getRepoReadContext(params, { ttlMs: 0 });
    return Response.json({ status: "success", data: config }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
