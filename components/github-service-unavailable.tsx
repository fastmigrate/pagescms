"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

const GithubServiceUnavailable = () => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const retry = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <Empty className="absolute inset-0 border-0 rounded-none">
      <EmptyHeader>
        <EmptyTitle>Content temporarily unavailable</EmptyTitle>
        <EmptyDescription>
          The CMS can&apos;t connect to the external content service right now.
          Your content remains safely stored. Please try again in a moment.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={retry} disabled={isPending}>
          Try again
          {isPending && <Loader className="size-4 animate-spin" />}
        </Button>
      </EmptyContent>
    </Empty>
  );
};

export { GithubServiceUnavailable };
