import assert from "node:assert/strict";
import test from "node:test";
import {
  GithubServiceUnavailableError,
  isGithubServiceUnavailableError,
  toGithubServiceUnavailableError,
} from "../lib/github-service-unavailable.ts";

test("maps GitHub 5xx responses to the safe service error", () => {
  for (const status of [500, 502, 503, 504, 599]) {
    const mapped = toGithubServiceUnavailableError({ status });
    assert.ok(mapped instanceof GithubServiceUnavailableError);
    assert.equal(isGithubServiceUnavailableError(mapped), true);
  }
});

test("maps fetch and nested network failures to the safe service error", () => {
  assert.ok(toGithubServiceUnavailableError(new TypeError("fetch failed")));
  assert.ok(
    toGithubServiceUnavailableError({
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    }),
  );
});

test("does not hide authentication, authorization, rate-limit, or app errors", () => {
  for (const error of [
    { status: 401 },
    { status: 403 },
    { status: 404 },
    { status: 429 },
    new Error("Unexpected application failure"),
  ]) {
    assert.equal(toGithubServiceUnavailableError(error), null);
    assert.equal(isGithubServiceUnavailableError(error), false);
  }
});

test("recognizes a structurally equivalent marked error", () => {
  assert.equal(
    isGithubServiceUnavailableError({ code: "GITHUB_SERVICE_UNAVAILABLE" }),
    true,
  );
});
