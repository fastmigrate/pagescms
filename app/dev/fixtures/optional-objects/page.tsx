import { notFound } from "next/navigation";
import { OptionalObjectsFixture } from "@/components/dev/optional-objects-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function OptionalObjectsFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <OptionalObjectsFixture />;
}
