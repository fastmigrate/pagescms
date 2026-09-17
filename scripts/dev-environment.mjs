const placeholderValues = {
  GITHUB_APP_ID: "your-github-app-id",
  GITHUB_APP_NAME: "your-github-app-machine-name",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nxxx\n-----END RSA PRIVATE KEY-----",
  GITHUB_APP_WEBHOOK_SECRET: "another-random-string-of-characters",
  GITHUB_APP_CLIENT_ID: "your-github-app-client-id",
  GITHUB_APP_CLIENT_SECRET: "your-github-app-client-secret",
};

const isPlaceholderValue = (key, value) =>
  !value || placeholderValues[key] === value.trim();

const isValidCryptoKey = (value) => {
  const normalized = value?.trim() || "";
  return /^[A-Za-z0-9+/]{43}=$/u.test(normalized) &&
    Buffer.from(normalized, "base64").length === 32;
};

const buildFixtureEnvironment = (environment = process.env) => ({
  ...environment,
  PAGESCMS_FIXTURES_ENABLED: "true",
});

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
  getPackageManagerInvocation,
  isPlaceholderValue,
  isValidCryptoKey,
};
