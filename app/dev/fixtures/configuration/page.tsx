import { notFound } from "next/navigation";
import { ConfigurationFixture } from "@/components/dev/configuration-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";
export default function ConfigurationFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <ConfigurationFixture />;
}
