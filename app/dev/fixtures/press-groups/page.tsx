import { notFound } from "next/navigation";
import { PressGroupsFixture } from "@/components/dev/press-groups-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function PressGroupsFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <PressGroupsFixture />;
}
