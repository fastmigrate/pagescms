type ContentOperation = "create" | "rename" | "delete" | "duplicate";
type ContentScope = "collection" | "file" | "settings";
type MediaOperation = "delete" | "rename";

type ContentOperations = Record<ContentOperation, boolean>;

const contentOperationDefaults: Record<ContentScope, ContentOperations> = {
  collection: {
    create: true,
    rename: true,
    delete: true,
    duplicate: false,
  },
  file: {
    create: true,
    rename: false,
    delete: true,
    duplicate: false,
  },
  settings: {
    create: true,
    rename: false,
    delete: false,
    duplicate: false,
  },
};

const resolveContentOperations = ({
  schema,
  scope,
}: {
  schema?: Record<string, any> | null;
  scope?: ContentScope;
}): ContentOperations => {
  const resolvedScope = scope ?? (
    schema?.type === "file"
      ? "file"
      : "collection"
  );

  const defaults = contentOperationDefaults[resolvedScope];
  const configured =
    schema?.operations && typeof schema.operations === "object"
      ? schema.operations
      : {};

  return {
    create: defaults.create && configured.create !== false,
    rename: defaults.rename && configured.rename !== false,
    delete: defaults.delete && configured.delete !== false,
    duplicate:
      resolvedScope === "collection"
      && configured.create !== false
      && (configured.duplicate === true || (
        configured.duplicate != null
        && typeof configured.duplicate === "object"
      )),
  };
};

const isContentOperationAllowed = (
  operation: ContentOperation,
  options: {
    schema?: Record<string, any> | null;
    scope?: ContentScope;
  },
) => resolveContentOperations(options)[operation];

// Callers supply normalized repository paths and normalized media input roots.
const isMediaOperationAllowed = (
  operation: MediaOperation,
  { configObject, paths }: {
    configObject?: Record<string, any> | null;
    paths: string[];
  },
) => {
  const media = configObject?.media;
  if (!Array.isArray(media)) return true;

  return !media.some((source: { input: string; operations?: Partial<Record<MediaOperation, boolean>> }) => (
    source.operations?.[operation] === false
    && paths.some(path => source.input === "" || path === source.input || path.startsWith(`${source.input}/`))
  ));
};

export {
  contentOperationDefaults,
  isContentOperationAllowed,
  isMediaOperationAllowed,
  resolveContentOperations,
};
