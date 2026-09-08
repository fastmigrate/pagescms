"use client";

import { useMemo } from "react";
import { Thumbnail } from "@/components/thumbnail";
import { Field } from "@/types/field";
import { thumbnailPresentation } from "./thumbnail-presentation";
import { useConfig } from "@/contexts/config-context";

const ViewComponent = ({
  value,
  field
}: {
  value: string;
  field: Field;
}) => {
  const extraValuesCount = value && Array.isArray(value) ? value.length - 1 : 0;

  const path = useMemo(() => {
    return !value
      ? null
      : Array.isArray(value)
        ? value[0]
        : value;
  }, [value]);

  const { config } = useConfig();

  const mediaName = field.options?.media || config?.object.media?.[0]?.name;

  const presentation = thumbnailPresentation(field.options);

  return (
    <span className="flex items-center gap-x-1.5">
      <Thumbnail name={mediaName} path={path} className={`${presentation.className} shrink-0 rounded-md`} fit={presentation.fit}/>
      {extraValuesCount > 0 && (
        <span className="text-muted-foreground text-xs">
          +{extraValuesCount}
        </span>
      )}
    </span>
  );
}

export { ViewComponent };