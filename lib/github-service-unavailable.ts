type ErrorLike = {
  status?: number;
  statusCode?: number;
  code?: string;
  cause?: unknown;
};

const GITHUB_SERVICE_UNAVAILABLE = "GITHUB_SERVICE_UNAVAILABLE";

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

class GithubServiceUnavailableError extends Error {
  readonly code = GITHUB_SERVICE_UNAVAILABLE;

  constructor(cause: unknown) {
    super("GitHub service unavailable.", { cause });
    this.name = "GithubServiceUnavailableError";
  }
}

const getErrorLike = (error: unknown): ErrorLike | null => {
  if (!error || typeof error !== "object") return null;
  return error as ErrorLike;
};

const isTransientGithubFailure = (error: unknown): boolean => {
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current; depth += 1) {
    const errorLike = getErrorLike(current);
    if (!errorLike) return false;

    const status =
      typeof errorLike.status === "number"
        ? errorLike.status
        : errorLike.statusCode;

    if (typeof status === "number" && status >= 500 && status <= 599) {
      return true;
    }

    if (
      typeof errorLike.code === "string" &&
      NETWORK_ERROR_CODES.has(errorLike.code)
    ) {
      return true;
    }

    if (current instanceof TypeError) return true;
    current = errorLike.cause;
  }

  return false;
};

const toGithubServiceUnavailableError = (
  error: unknown,
): GithubServiceUnavailableError | null => {
  if (!isTransientGithubFailure(error)) return null;
  return new GithubServiceUnavailableError(error);
};

const isGithubServiceUnavailableError = (
  error: unknown,
): error is GithubServiceUnavailableError => {
  if (error instanceof GithubServiceUnavailableError) return true;
  const errorLike = getErrorLike(error);
  return errorLike?.code === GITHUB_SERVICE_UNAVAILABLE;
};

export {
  GithubServiceUnavailableError,
  isGithubServiceUnavailableError,
  toGithubServiceUnavailableError,
};
