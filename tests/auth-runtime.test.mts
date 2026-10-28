import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { render } from "@react-email/render";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const baseURL = "https://cms.example.invalid";

async function authFixture(t: TestContext) {
  const rows: MemoryDB = { user: [], account: [], session: [], verification: [] };
  const mail: Array<{ to: string; subject: string; html: string }> = [];
  const hooks: Array<[string, ...string[]]> = [];
  const githubRequests: string[] = [];
  const profile = {
    id: 12345678,
    login: "fixture-editor",
    name: null,
    email: null as string | null,
    avatar_url: "https://avatars.example.invalid/editor.png",
  };
  const githubEmail = { email: "editor@example.invalid", primary: true, verified: true, visibility: "private" };
  const schema = {
    userTable: { id: "id" },
    accountTable: { userId: "userId", providerId: "providerId" },
  };
  type Condition = { matches: (row: any) => boolean };
  const eq = (field: string, value: unknown): Condition => ({ matches: (row) => row[field] === value });
  const query = (table: string) => ({ findFirst: async ({ where }: any) => {
    const predicate = typeof where === "function" && table === "user"
      ? where(schema.userTable, { eq }) : where;
    return rows[table].find(predicate.matches);
  } });

  // Every possible fetch is intercepted; an unexpected request fails locally.
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    githubRequests.push(url);
    if (url === "https://github.com/login/oauth/access_token") {
      assert.equal(init?.method, "POST");
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("code"), "fixture-authorization-code");
      assert.equal(body.get("redirect_uri"), `${baseURL}/api/auth/callback/github`);
      return Response.json({ access_token: "fixture-github-token", token_type: "bearer", scope: "repo,user:email" });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-github-token");
    if (url === "https://api.github.com/user") return Response.json(profile);
    if (url === "https://api.github.com/user/emails") {
      return Response.json([
        { email: "secondary@example.invalid", primary: false, verified: false, visibility: "private" },
        githubEmail,
      ]);
    }
    throw new Error(`Unexpected external request: ${url}`);
  });

  const mocks: Record<string, any> = {
    "better-auth": { betterAuth },
    "better-auth/adapters/drizzle": { drizzleAdapter: () => memoryAdapter(rows) },
    "better-auth/next-js": { nextCookies },
    "better-auth/plugins": { emailOTP },
    "@/db": { db: {
      query: { userTable: query("user"), accountTable: query("account") },
      update: (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: async (predicate: Condition) => {
        assert.equal(table, schema.userTable);
        for (const user of rows.user.filter(predicate.matches)) Object.assign(user, patch);
      } }) }),
    } },
    "@/db/schema": schema,
    "drizzle-orm": { eq, and: (...predicates: Condition[]): Condition => ({ matches: (row) => predicates.every((predicate) => predicate.matches(row)) }) },
    "@/lib/base-url": { getBaseUrl: () => baseURL },
    "@/lib/github-legacy-stub-repair": { repairLegacyGithubStubOnLogin: async (sessionId: string, userId: string) => { hooks.push(["repair", sessionId, userId]); } },
    "@/lib/utils/octokit": { createOctokitInstance: (token: string) => {
      assert.equal(token, "fixture-github-token");
      return { rest: { users: { getAuthenticated: async () => ({ data: await (await fetch("https://api.github.com/user", {
        headers: { authorization: `Bearer ${token}` },
      })).json() }) } } };
    } },
    "@/lib/collaborator-access": { bindCollaboratorInvitesToUser: async (user: any) => { hooks.push(["bind", user.id]); } },
    "@/lib/mailer": { sendEmail: async (message: typeof mail[number]) => { mail.push(message); } },
    "@react-email/render": { render },
  };
  const modules = new Map<string, any>();
  function load(path: string): any {
    if (modules.has(path)) return modules.get(path).exports;
    const mod = { exports: {} };
    modules.set(path, mod);
    const require = (id: string): any => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (!id.startsWith("@/") && !id.startsWith(".")) return nativeRequire(id);
      const base = id.startsWith("@/") ? resolve(root, id.slice(2)) : resolve(dirname(path), id);
      const file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!file) throw new Error(`Missing test dependency ${id}`);
      return load(file);
    };
    new Function("require", "module", "exports", "process", ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText)(require, mod, mod.exports, { env: {
      AUTH_SECRET: "fixture-only-4nQ9!w7Z2s8xR6kP3mV5bC1hT0yL9uE2",
      GITHUB_APP_CLIENT_ID: "fixture-client-id",
      GITHUB_APP_CLIENT_SECRET: "fixture-client-secret",
      BASE_URL: baseURL,
    } });
    return mod.exports;
  }
  const githubAccount = load(resolve(root, "lib/github-account.ts"));
  mocks["@/lib/github-account"] = { ...githubAccount, syncGithubProfileOnLogin: async (userId: string) => {
    hooks.push(["sync", userId]);
    await githubAccount.syncGithubProfileOnLogin(userId);
  } };
  // Load the production configuration and email template, replacing external I/O only.
  const { auth } = load(resolve(root, "lib/auth.ts"));
  await auth.$context;
  const request = (path: string, body?: Record<string, unknown>, cookie?: string) => auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin: baseURL, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  return { rows, mail, hooks, githubRequests, profile, githubEmail, request };
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

test("production GitHub OAuth keeps the raw provider subject and profile mapping across sign-ins", async (t) => {
  const f = await authFixture(t);
  async function signIn() {
    const start = await f.request("/sign-in/social", { provider: "github", callbackURL: `${baseURL}/editor`, disableRedirect: true });
    assert.equal(start.status, 200);
    const authorizeURL = new URL((await start.json()).url);
    assert.equal(authorizeURL.origin, "https://github.com");
    assert.ok(authorizeURL.searchParams.get("scope")?.split(" ").includes("repo"));
    const state = authorizeURL.searchParams.get("state");
    assert.ok(state);
    const callback = await f.request(`/callback/github?code=fixture-authorization-code&state=${encodeURIComponent(state)}`, undefined, cookies(start));
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), `${baseURL}/editor`);
    const session = await f.request("/get-session", undefined, cookies(callback));
    assert.equal(session.status, 200);
    return session.json();
  }

  const first = await signIn();
  assert.equal(f.rows.user.length, 1);
  assert.equal(f.rows.account.length, 1);
  assert.equal(f.rows.account[0].providerId, "github");
  assert.equal(f.rows.account[0].accountId, String(f.profile.id));
  assert.equal(f.rows.account[0].userId, first.user.id);
  assert.notEqual(first.user.id, String(f.profile.id));
  assert.equal(first.user.email, f.githubEmail.email);
  assert.equal(first.user.emailVerified, true);
  assert.equal(first.user.name, "fixture-editor");
  assert.equal(first.user.githubUsername, "fixture-editor");
  assert.equal(first.user.image, f.profile.avatar_url);

  // Mutable GitHub profile fields must not select a different local identity.
  f.profile.login = "renamed-editor";
  f.githubEmail.email = "renamed@example.invalid";
  const second = await signIn();
  assert.equal(second.user.id, first.user.id);
  assert.equal(f.rows.user.length, 1);
  assert.equal(f.rows.account.length, 1);
  assert.equal(f.rows.account[0].accountId, "12345678");
  assert.equal(f.rows.session.length, 2);
  assert.deepEqual(f.hooks.filter(([hook]) => hook === "bind"), [["bind", first.user.id], ["bind", first.user.id]]);
  assert.equal(second.user.githubUsername, "renamed-editor");
  assert.deepEqual(f.githubRequests, Array(2).fill([
    "https://github.com/login/oauth/access_token", "https://api.github.com/user", "https://api.github.com/user/emails", "https://api.github.com/user",
  ]).flat());
});

test("production encrypted email OTP rejects wrong/reused codes and creates a readable session", async (t) => {
  const f = await authFixture(t);
  const email = "otp-editor@example.invalid";
  for (let attempt = 0; attempt < 2; attempt++) {
    const sent = await f.request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    assert.equal(sent.status, 200);
  }
  assert.equal(f.mail.length, 2);
  assert.equal(f.mail[0].to, email);
  const otp = f.mail[0].subject.match(/temporary code is (\d{6})$/)?.[1];
  assert.ok(otp);
  assert.match(f.mail[0].html, new RegExp(otp));
  assert.equal(f.mail[1].subject, f.mail[0].subject);
  assert.equal(f.rows.verification.length, 1);
  assert.notEqual(f.rows.verification[0].value, `${otp}:0`);

  const wrongOTP = String((Number(otp) + 1) % 1000000).padStart(6, "0");
  const rejected = await f.request("/sign-in/email-otp", { email, otp: wrongOTP });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "INVALID_OTP");
  assert.equal(f.rows.user.length, 0);
  assert.equal(f.rows.session.length, 0);
  assert.deepEqual(f.hooks, []);

  const accepted = await f.request("/sign-in/email-otp", { email, otp });
  assert.equal(accepted.status, 200);
  const signedIn = await accepted.json();
  assert.equal(signedIn.user.email, email);
  assert.equal(signedIn.user.emailVerified, true);
  assert.equal(f.rows.user.length, 1);
  assert.equal(f.rows.session.length, 1);
  assert.equal(f.rows.verification.length, 0);
  const storedSession = f.rows.session[0];
  assert.equal(storedSession.token, signedIn.token);
  assert.equal(storedSession.userId, signedIn.user.id);
  assert.deepEqual(f.hooks, [["repair", storedSession.id, signedIn.user.id], ["sync", signedIn.user.id], ["bind", signedIn.user.id]]);

  const session = await f.request("/get-session", undefined, cookies(accepted));
  assert.equal(session.status, 200);
  const current = await session.json();
  assert.equal(current.user.id, signedIn.user.id);
  assert.equal(current.session.token, signedIn.token);
  assert.equal(await (await f.request("/get-session")).json(), null);
  const reused = await f.request("/sign-in/email-otp", { email, otp });
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).code, "INVALID_OTP");
  assert.equal(f.rows.session.length, 1);
  assert.deepEqual(f.githubRequests, []);
});
