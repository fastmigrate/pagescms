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

const unsafePathSegments = new Set(["__proto__", "prototype", "constructor"]);

const assertSafeKey = (key: string) => {
  if (unsafePathSegments.has(key)) {
    throw new Error(`Unsafe content key "${key}" cannot be duplicated.`);
  }
};

const setOwnContentValue = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === "object" && !Array.isArray(value)
);

const cloneContentValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneContentValue);
  if (!isPlainObject(value)) return value;

  const clone: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    setOwnContentValue(clone, key, cloneContentValue(child));
  }
  return clone;
};

const mergeDuplicateValue = (
  source: unknown,
  modeled: unknown,
  existingKeysOnly: boolean,
): unknown => {
  if (Array.isArray(modeled)) {
    if (!Array.isArray(source)) return cloneContentValue(modeled);
    return modeled.map((value, index) => (
      mergeDuplicateValue(source[index], value, existingKeysOnly)
    ));
  }
  if (isPlainObject(modeled) && isPlainObject(source)) {
    return mergeDuplicateContent(source, modeled, existingKeysOnly);
  }
  return cloneContentValue(modeled);
};

function mergeDuplicateContent(
  source: Record<string, unknown>,
  modeled: Record<string, unknown>,
  existingKeysOnly = false,
): Record<string, unknown> {
  const result = cloneContentValue(source) as Record<string, unknown>;
  for (const [key, value] of Object.entries(modeled)) {
    const sourceHasKey = Object.hasOwn(result, key);
    if (existingKeysOnly && !sourceHasKey) continue;
    const sourceValue = sourceHasKey ? result[key] : undefined;
    setOwnContentValue(
      result,
      key,
      mergeDuplicateValue(sourceValue, value, existingKeysOnly),
    );
  }
  return result;
}

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
  parts.forEach(assertSafeKey);

  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = Object.hasOwn(current, part) ? current[part] : undefined;
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      setOwnContentValue(current, part, {});
    }
    current = current[part] as Record<string, unknown>;
  }
  setOwnContentValue(current, parts[parts.length - 1], value);
};

const regenerateUuidFields = (
  content: Record<string, unknown>,
  fields: Array<Record<string, any>>,
) => {
  const visitBlock = (value: unknown, field: Record<string, any>) => {
    if (!isPlainObject(value)) return;
    const blockKey = field.blockKey || "_block";
    const blockName = Object.hasOwn(value, blockKey) ? value[blockKey] : undefined;
    const block = field.blocks?.find((item: Record<string, any>) => (
      item.name === blockName
    ));
    if (block?.fields) regenerateUuidFields(value, block.fields);
  };

  for (const field of fields) {
    const value = Object.hasOwn(content, field.name) ? content[field.name] : undefined;

    if (field.list) {
      if (!Array.isArray(value)) continue;
      if (field.type === "uuid") {
        setOwnContentValue(content, field.name, value.map(() => crypto.randomUUID()));
      } else if (field.type === "object") {
        value.forEach((item) => {
          if (isPlainObject(item)) regenerateUuidFields(item, field.fields ?? []);
        });
      } else if (field.type === "block") {
        value.forEach((item) => visitBlock(item, field));
      }
      continue;
    }

    if (field.type === "uuid") {
      setOwnContentValue(content, field.name, field.default !== undefined
        ? cloneContentValue(field.default)
        : crypto.randomUUID());
    } else if (field.type === "object" && isPlainObject(value)) {
      regenerateUuidFields(value, field.fields ?? []);
    } else if (field.type === "block") {
      visitBlock(value, field);
    }
  }
};

const buildDuplicateContent = ({
  source,
  field,
  value,
  draft,
  fields = [],
}: {
  source: Record<string, unknown>;
  field: string;
  value: string;
  draft: boolean;
  fields?: Array<Record<string, any>>;
}): Record<string, unknown> => {
  const duplicate = mergeDuplicateContent({}, source);
  setValueAtPath(duplicate, field, value);
  if (draft) duplicate.draft = true;
  regenerateUuidFields(duplicate, fields);
  return duplicate;
};

export {
  buildDuplicateContent,
  mergeDuplicateContent,
  resolveDuplicateOperation,
  type ResolvedDuplicateOperation,
};
