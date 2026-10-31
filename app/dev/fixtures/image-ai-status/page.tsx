import { notFound } from "next/navigation";
import { ImageAiStatusFixture } from "@/components/dev/image-ai-status-fixture";
import { areDevFixturesEnabled } from "@/lib/dev-fixtures";

export const dynamic = "force-dynamic";

export default function ImageAiStatusFixturePage() {
  if (!areDevFixturesEnabled()) notFound();
  return <ImageAiStatusFixture />;
}
