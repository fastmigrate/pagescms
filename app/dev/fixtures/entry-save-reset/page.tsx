import { notFound } from "next/navigation";
import { EntrySaveResetFixture } from "@/components/dev/entry-save-reset-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function EntrySaveResetFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <EntrySaveResetFixture />;
}
