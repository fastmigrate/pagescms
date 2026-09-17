import type { ApiSuccess, EntryData } from "@/types/api";

const fixtureFlag = "true";

const areDevFixturesEnabled = ({
  nodeEnv = process.env.NODE_ENV,
  enabled = process.env.PAGESCMS_FIXTURES_ENABLED,
}: {
  nodeEnv?: string;
  enabled?: string;
} = {}) => nodeEnv !== "production" && enabled === fixtureFlag;

const slugifyFixtureValue = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/gu, "")
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/gu, "-")
  .replace(/^-+|-+$/gu, "");

const createDuplicateFixtureResponse = (
  value: string,
): ApiSuccess<EntryData> => {
  const slug = slugifyFixtureValue(value) || "copy";
  const path = `website/src/content/jobs/${slug}.json`;

  return {
    status: "success",
    message: `Created ${path}`,
    data: {
      name: `${slug}.json`,
      path,
      sha: "fixture-new-file-sha",
      contentObject: {
        title: value.trim(),
        draft: true,
        description: "Saved source content remains unchanged in the fixture.",
      },
    },
  };
};

export {
  areDevFixturesEnabled,
  createDuplicateFixtureResponse,
  slugifyFixtureValue,
};
