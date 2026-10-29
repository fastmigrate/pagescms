import { notFound } from "next/navigation";
import { CollectionReorderFixture } from "@/components/dev/collection-reorder-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function CollectionReorderFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <CollectionReorderFixture />;
}
