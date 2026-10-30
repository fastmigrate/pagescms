import { notFound } from "next/navigation";
import { CatalogExchangeFixture } from "@/components/dev/catalog-exchange-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function CatalogExchangeFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <CatalogExchangeFixture />;
}
