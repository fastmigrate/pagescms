import { notFound } from "next/navigation";
import { EntryRenameFixture } from "@/components/dev/entry-rename-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default async function EntryRenameFixturePage({ searchParams }: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (!areDevFixturesEnabled()) notFound();
  const { mode } = await searchParams;
  return <EntryRenameFixture mode={mode === "list" || mode === "code" ? mode : "object"} />;
}
