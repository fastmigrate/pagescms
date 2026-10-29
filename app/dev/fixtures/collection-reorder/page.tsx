import { notFound } from "next/navigation";
import { CollectionReorderFixture } from "@/components/dev/collection-reorder-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default async function CollectionReorderFixturePage({ searchParams }: { searchParams: Promise<{ single?: string }> }) {
  if (!areDevFixturesEnabled()) notFound();
  return <CollectionReorderFixture singleGroup={(await searchParams).single === "1"} />;
}
