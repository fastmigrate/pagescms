import { notFound } from 'next/navigation';
import { MediaAiFixture } from '@/components/dev/media-ai-fixture';
import { areDevFixturesEnabled } from '@/lib/dev-fixtures';
export const dynamic = 'force-dynamic';
export default function MediaAiFixturePage() { if (!areDevFixturesEnabled()) notFound(); return <MediaAiFixture />; }
