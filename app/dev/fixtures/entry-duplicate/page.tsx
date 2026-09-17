import { notFound } from "next/navigation";
import { EntryDuplicateFixture } from "@/components/dev/entry-duplicate-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function EntryDuplicateFixturePage() {
  if (!areDevFixturesEnabled()) notFound();

  return <EntryDuplicateFixture />;
}
