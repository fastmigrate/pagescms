const placeholderPattern = /(?:your-|xxx|another-random|random-string-of-characters)/u;

const isPlaceholderValue = (value) => !value || placeholderPattern.test(value.trim());

const isValidCryptoKey = (value) => {
  const normalized = value?.trim() || "";
  return /^[A-Za-z0-9+/]{43}=$/u.test(normalized) &&
    Buffer.from(normalized, "base64").length === 32;
};

const buildFixtureEnvironment = (environment = process.env) => ({
  ...environment,
  PAGESCMS_FIXTURES_ENABLED: "true",
});

export {
  buildFixtureEnvironment,
  isPlaceholderValue,
  isValidCryptoKey,
};
