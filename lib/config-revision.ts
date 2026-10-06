import { createHttpError } from "@/lib/api-error";

const assertConfigRevision = (expected: unknown, actual: string | undefined) => {
  if (typeof expected !== "string" || !expected || expected !== actual) {
    throw createHttpError("Configuration changed. Your draft is kept. Load the updated fields before saving.", 409);
  }
};
export { assertConfigRevision };
