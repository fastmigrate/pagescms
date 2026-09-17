const placeholderValues = {
  GITHUB_APP_ID: "your-github-app-id",
  GITHUB_APP_NAME: "your-github-app-machine-name",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nxxx\n-----END RSA PRIVATE KEY-----",
  GITHUB_APP_WEBHOOK_SECRET: "another-random-string-of-characters",
  GITHUB_APP_CLIENT_ID: "your-github-app-client-id",
  GITHUB_APP_CLIENT_SECRET: "your-github-app-client-secret",
};

const sandboxOnlyEnvironmentKeys = new Set([
  "ADMIN_EMAILS",
  "AUTH_SECRET",
  "BASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CRYPTO_KEY",
  "DATABASE_URL",
  "EMAIL_FROM",
  "EMAIL_PROVIDER",
  "PAGESCMS_FIXTURES_ENABLED",
]);

const fixtureIsolatedEnvironmentKeys = new Set([
  ...sandboxOnlyEnvironmentKeys,
  ...Object.keys(placeholderValues),
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
]);

const isSandboxOnlyEnvironmentKey = (key) =>
  sandboxOnlyEnvironmentKeys.has(key) ||
  ["GITHUB_APP_", "RESEND_", "SMTP_"].some((prefix) =>
    key.startsWith(prefix),
  );

const isPlaceholderValue = (key, value) =>
  !value || placeholderValues[key] === value.trim();

const getInheritedSandboxKeys = (environment = process.env) =>
  Object.entries(environment)
    .filter(
      ([key, value]) =>
        value && isSandboxOnlyEnvironmentKey(key),
    )
    .map(([key]) => key)
    .sort();

const isValidCryptoKey = (value) => {
  const normalized = value?.trim() || "";
  return /^[A-Za-z0-9+/]{43}=$/u.test(normalized) &&
    Buffer.from(normalized, "base64").length === 32;
};

const selectExistingCryptoKey = (targetFileValue, environmentValue) => {
  if (isValidCryptoKey(targetFileValue)) return targetFileValue.trim();
  if (isValidCryptoKey(environmentValue)) return environmentValue.trim();
  return "";
};

const selectExistingAuthSecret = (targetFileValue, environmentValue) => {
  const isConfigured = (value) => {
    const normalized = value?.trim() || "";
    return normalized && normalized !== "random-string-of-characters";
  };

  if (isConfigured(targetFileValue)) return targetFileValue.trim();
  if (isConfigured(environmentValue)) return environmentValue.trim();
  return "";
};

const isLocalSandboxDatabaseUrl = (value, expectedPort = "5432") => {
  try {
    const url = new URL(value);
    const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
    const port = url.port || "5432";

    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      loopbackHosts.has(url.hostname) &&
      port === String(expectedPort)
    );
  } catch {
    return false;
  }
};

const buildFixtureEnvironment = (environment = process.env) => {
  const fixtureEnvironment = { ...environment };
  for (const key of new Set([
    ...fixtureIsolatedEnvironmentKeys,
    ...Object.keys(environment).filter(isSandboxOnlyEnvironmentKey),
  ])) {
    fixtureEnvironment[key] = "";
  }
  fixtureEnvironment.PAGESCMS_FIXTURES_ENABLED = "true";
  return fixtureEnvironment;
};

const buildSandboxEnvFiles = (path, contents) => [{ path, contents }];

const getPackageManagerInvocation = (
  environment = process.env,
  nodeExecutable = process.execPath,
) => {
  const cli = environment.npm_execpath?.trim();
  if (!cli) {
    throw new Error("Missing npm_execpath. Start this launcher with npm run dev:local.");
  }
  return { command: nodeExecutable, cli };
};

export {
  buildFixtureEnvironment,
  buildSandboxEnvFiles,
  getPackageManagerInvocation,
  getInheritedSandboxKeys,
  isLocalSandboxDatabaseUrl,
  isPlaceholderValue,
  isValidCryptoKey,
  selectExistingAuthSecret,
  selectExistingCryptoKey,
};
