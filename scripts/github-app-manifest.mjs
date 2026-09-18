const webhookEvents = [
  "installation_target",
  "repository",
  "push",
  "delete",
  "check_run",
  "check_suite",
  "status",
  "workflow_run",
];

export function buildGitHubAppManifest({ appName, baseUrl, localCallbackUrl }) {
  const manifest = {
    name: appName,
    url: baseUrl,
    callback_urls: [`${baseUrl}/api/auth/callback/github`],
    redirect_url: localCallbackUrl,
    description:
      "Pages CMS is an open source CMS for editing content in GitHub repositories.",
    public: false,
    default_permissions: {
      administration: "write",
      actions: "write",
      checks: "read",
      statuses: "read",
      contents: "write",
      // API key is "emails" (the UI label "Email addresses" is not the manifest key)
      emails: "read",
      metadata: "read",
    },
    request_oauth_on_install: false,
    setup_on_update: true,
    setup_url: `${baseUrl}/`,
  };

  if (!isLoopbackBaseUrl(baseUrl)) {
    manifest.default_events = webhookEvents;
    manifest.hook_attributes = {
      url: `${baseUrl}/api/webhook/github`,
      active: true,
      // GitHub's manifest validation rejects a "secret" key here; the
      // conversion response returns a GitHub-generated webhook_secret instead.
    };
  }

  return manifest;
}

export function isLoopbackBaseUrl(baseUrl) {
  const hostname = new URL(baseUrl).hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase();

  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}
