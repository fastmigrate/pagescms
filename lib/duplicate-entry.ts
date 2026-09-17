type DuplicateOperationConfig = {
  label?: string;
  description?: string;
  field?: string;
  fieldLabel?: string;
  button?: string;
  draft?: boolean;
};

type ResolvedDuplicateOperation = {
  label: string;
  description: string;
  field: string;
  fieldLabel?: string;
  button: string;
  draft: boolean;
};

const resolveDuplicateOperation = (
  schema: Record<string, any>,
  primaryField?: string,
): ResolvedDuplicateOperation | null => {
  const configured = schema?.operations?.duplicate;
  if (configured !== true && (!configured || typeof configured !== "object")) {
    return null;
  }

  const options: DuplicateOperationConfig = configured === true ? {} : configured;
  const field = options.field ?? primaryField;
  if (!field) return null;

  const label = options.label?.trim() || "Duplicate";
  return {
    label,
    description:
      options.description?.trim()
      || "Create a new entry from the latest saved version.",
    field,
    fieldLabel: options.fieldLabel?.trim() || undefined,
    button: options.button?.trim() || label,
    draft: options.draft === true,
  };
};

const setValueAtPath = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) => {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("Duplicate field path is required.");

  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
};

const buildDuplicateContent = ({
  source,
  field,
  value,
  draft,
}: {
  source: Record<string, unknown>;
  field: string;
  value: string;
  draft: boolean;
}): Record<string, unknown> => {
  const duplicate = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  setValueAtPath(duplicate, field, value);
  if (draft) duplicate.draft = true;
  return duplicate;
};

export {
  buildDuplicateContent,
  resolveDuplicateOperation,
  type ResolvedDuplicateOperation,
};
