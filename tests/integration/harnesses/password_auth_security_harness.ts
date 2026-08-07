import { join } from "node:path";
import { pathToFileURL } from "node:url";
// deno-lint-ignore no-import-prefix -- this harness runs under generated project configs too.
import { App } from "jsr:@fresh/core@^2.3.3";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ?? `expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

function assertThrows(action: () => unknown, pattern: RegExp) {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, "expected an Error");
    assert(pattern.test(error.message), `unexpected error: ${error.message}`);
    return;
  }
  throw new Error("expected action to throw");
}

const root = Deno.env.get("GENERATED_PROJECT_ROOT");
if (!root) throw new Error("GENERATED_PROJECT_ROOT is required");

const generated = (path: string) =>
  pathToFileURL(join(root, ...path.split("/"))).href;
const {
  collectPendingSupabaseChanges,
  commitSupabaseResponse,
  createPendingSupabaseChanges,
  resolveRedirectPath,
  withFreshBasePath,
} = await import(generated("lib/supabase/server.ts"));
const { isSupabasePublicPath, scopedAuthCsrf: authMiddleware } = await import(
  generated("lib/supabase/middleware.ts")
);

interface TestCookie {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    priority?: "low" | "medium" | "high";
    sameSite?: boolean | "lax" | "strict" | "none";
    secure?: boolean;
    partitioned?: boolean;
  };
}

const cookie = (name: string, value: string): TestCookie => ({
  name,
  value,
  options: { httpOnly: true, path: "/", sameSite: "lax" },
});
const emptyPending = (): {
  cookies: Array<ReturnType<typeof cookie>>;
  headers: Headers;
} => ({ cookies: [], headers: new Headers() });

Deno.test("redirect helper accepts internal URL components", () => {
  assertEquals(resolveRedirectPath("/account"), "/account");
  assertEquals(
    resolveRedirectPath("/account?tab=security#password"),
    "/account?tab=security#password",
  );
  assertEquals(resolveRedirectPath(null, "/account"), "/account");
});

Deno.test("global auth middleware exposes only upstream public prefixes", () => {
  assert(isSupabasePublicPath("/auth/login", ""));
  assert(isSupabasePublicPath("/login", ""));
  assert(!isSupabasePublicPath("/", ""));
  assert(!isSupabasePublicPath("/api/webhook", ""));
  assert(isSupabasePublicPath("/portal/auth/login", "/portal"));
  assert(isSupabasePublicPath("/portal/login", "/portal"));
  assert(!isSupabasePublicPath("/portal/protected", "/portal"));
});

Deno.test("redirect helper rejects unsafe candidates and fallbacks", () => {
  const unsafe = [
    "https://evil.example/account",
    "https://fresh-supabase.invalid/account",
    "//evil.example/account",
    "/\\evil.example/account",
    "/%5cevil.example/account",
    "/line\nbreak",
    "/encoded%0abreak",
    "/malformed%2",
    "/.//evil.example/path",
    "/foo/..//evil.example/path",
    "/%2e//evil.example/path",
    "/%2e%2e//evil.example/path",
    "/a/%2e%2e//evil.example/path",
    "account",
  ];
  for (const value of unsafe) {
    assertEquals(resolveRedirectPath(value, "/safe"), "/safe", value);
  }
  for (
    const fallback of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/bad%0afallback",
      "/bad%2",
      "/.//fallback.example",
      "/a/..//fallback.example",
      "/%2e//fallback.example",
      "/%2e%2e//fallback.example",
    ]
  ) {
    assertThrows(() => resolveRedirectPath("/safe", fallback), /fallback/);
  }
});

Deno.test("every emitted redirect stays same-origin after normalization", () => {
  const values = [
    "/",
    "/account",
    "/account?tab=security#password",
    "/a/../account",
    "/teams%2Fadmin",
    "/%252e%252e/account",
  ];
  for (const origin of ["https://app.example", "http://localhost:8000"]) {
    for (const value of values) {
      const resolved = resolveRedirectPath(value, "/safe");
      const parsed = new URL(resolved, origin);
      assertEquals(parsed.origin, origin, `${origin} ${value} => ${resolved}`);
      assert(
        !resolved.startsWith("//"),
        `network-path output: ${value} => ${resolved}`,
      );
    }
  }
});

Deno.test("encoded slash retains URL-standard same-origin semantics", () => {
  const value = "/teams%2Fadmin?from=%252Faccount#member";
  const resolved = resolveRedirectPath(value, "/safe");
  const parsed = new URL(resolved, "https://app.example");
  assertEquals(parsed.origin, "https://app.example");
  assertEquals(parsed.pathname, "/teams%2Fadmin");
  assert(parsed.pathname !== "/teams/admin");
  assertEquals(resolveRedirectPath(resolved, "/safe"), resolved);
});

Deno.test("application paths honor Fresh basePath without weakening redirects", () => {
  assertEquals(
    resolveRedirectPath(
      "/portal/account?tab=security",
      "/portal/protected",
      "/portal",
    ),
    "/portal/account?tab=security",
  );
  assertEquals(
    resolveRedirectPath("/host-page", "/portal/protected", "/portal"),
    "/portal/protected",
  );
  assertEquals(
    resolveRedirectPath("/portal-other", "/portal/protected", "/portal"),
    "/portal/protected",
  );
  assertThrows(
    () => resolveRedirectPath("/portal/safe", "/host-page", "/portal"),
    /basePath/,
  );
  assertEquals(withFreshBasePath("", "/auth/login"), "/auth/login");
  assertEquals(
    withFreshBasePath("/portal", "/auth/login"),
    "/portal/auth/login",
  );
  assertEquals(
    withFreshBasePath("/portal/", "/protected?tab=1"),
    "/portal/protected?tab=1",
  );
  assertThrows(
    () => withFreshBasePath("//evil.example", "/auth/login"),
    /basePath/,
  );
  assertThrows(
    () => withFreshBasePath("/portal", "//evil.example"),
    /Application path/,
  );
});

Deno.test("response commit preserves existing and Supabase cookies", () => {
  const headers = new Headers();
  headers.append("set-cookie", "app-session=one; Path=/");
  headers.append("set-cookie", "preferences=two; Path=/");
  const pending = emptyPending();
  const access = cookie("sb-access", "access value");
  access.options.secure = true;
  access.options.partitioned = true;
  access.options.priority = "high";
  pending.cookies.push(access);
  pending.cookies.push(cookie("sb-refresh", "refresh value"));

  const committed = commitSupabaseResponse(
    new Response("ok", { headers }),
    pending,
  );
  assertEquals(committed.headers.getSetCookie(), [
    "app-session=one; Path=/",
    "preferences=two; Path=/",
    "sb-access=access%20value; Path=/; HttpOnly; Secure; Partitioned; Priority=High; SameSite=Lax",
    "sb-refresh=refresh%20value; Path=/; HttpOnly; SameSite=Lax",
  ]);
});

Deno.test("response commit normalizes cookie policies and deletion cookies", () => {
  const pending = emptyPending();
  const strict = cookie("strict", "one");
  strict.options.sameSite = true;
  const none = cookie("none", "two");
  none.options.sameSite = "none";
  none.options.secure = true;
  const deleted = cookie("deleted", "");
  deleted.options.maxAge = 0;
  pending.cookies.push(strict, none, deleted);

  assertEquals(
    commitSupabaseResponse(new Response("ok"), pending).headers.getSetCookie(),
    [
      "strict=one; Path=/; HttpOnly; SameSite=Strict",
      "none=two; Path=/; HttpOnly; Secure; SameSite=None",
      "deleted=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    ],
  );
});

Deno.test("response commit clones immutable upstream response headers", async () => {
  const upstream = await fetch("data:text/plain,proxied");
  assertThrows(() => upstream.headers.set("x-test", "no"), /immutable/i);
  const pending = emptyPending();
  pending.cookies.push(cookie("sb-access", "value"));
  const committed = commitSupabaseResponse(upstream, pending);
  assertEquals(await committed.text(), "proxied");
  assertEquals(
    committed.headers.getSetCookie(),
    ["sb-access=value; Path=/; HttpOnly; SameSite=Lax"],
  );
});

Deno.test("response commit rejects cookie injection characters", () => {
  const invalidName = emptyPending();
  invalidName.cookies.push(cookie("bad\nname", "value"));
  assertThrows(
    () => commitSupabaseResponse(new Response("ok"), invalidName),
    /invalid cookie/i,
  );

  const invalidValue = emptyPending();
  invalidValue.cookies.push(cookie("name", "bad;value"));
  assertThrows(
    () => commitSupabaseResponse(new Response("ok"), invalidValue),
    /invalid cookie/i,
  );

  const invalidPath = emptyPending();
  const pathCookie = cookie("name", "value");
  pathCookie.options.path = "/\r\nInjected: true";
  invalidPath.cookies.push(pathCookie);
  assertThrows(
    () => commitSupabaseResponse(new Response("ok"), invalidPath),
    /cookie path/i,
  );
});

Deno.test("server adapter collects every cookie and response cache header", () => {
  const pending = createPendingSupabaseChanges();
  collectPendingSupabaseChanges(
    pending,
    [cookie("sb-access", "first"), cookie("sb-refresh", "second")],
    { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  );
  collectPendingSupabaseChanges(
    pending,
    [cookie("sb-access.1", "third")],
    { Expires: "0" },
  );
  assertEquals(
    pending.cookies.map((value: { name: string }) => value.name),
    ["sb-access", "sb-refresh", "sb-access.1"],
  );
  assertEquals(pending.headers.get("cache-control"), "private, no-store");
  assertEquals(pending.headers.get("pragma"), "no-cache");
  assertEquals(pending.headers.get("expires"), "0");
});

Deno.test("response commit replaces cache policy and ignores unrelated pending headers", () => {
  const pending = emptyPending();
  pending.headers.set("cache-control", "private, no-store");
  pending.headers.set("expires", "0");
  pending.headers.set("pragma", "no-cache");
  pending.headers.set("x-untrusted", "discarded");
  const committed = commitSupabaseResponse(
    new Response("ok", {
      headers: {
        "cache-control": "public, max-age=3600",
        expires: "Wed, 21 Oct 2099 07:28:00 GMT",
        pragma: "cache",
      },
    }),
    pending,
  );
  assertEquals(committed.headers.get("cache-control"), "private, no-store");
  assertEquals(committed.headers.get("expires"), "0");
  assertEquals(committed.headers.get("pragma"), "no-cache");
  assertEquals(committed.headers.get("x-untrusted"), null);
});

Deno.test("response commit rejects invalid pending response state", async () => {
  const pending = emptyPending();
  pending.cookies.push(cookie("sb", "token"));

  const consumed = new Response("used");
  await consumed.text();
  assertThrows(
    () => commitSupabaseResponse(consumed, pending),
    /consumed or locked/,
  );

  const stream = new ReadableStream<Uint8Array>();
  const locked = new Response(stream);
  const reader = locked.body!.getReader();
  assertThrows(
    () => commitSupabaseResponse(locked, pending),
    /consumed or locked/,
  );
  await reader.cancel();

  assertThrows(
    () => commitSupabaseResponse(Response.error(), pending),
    /status 0/,
  );
});

Deno.test("response commit handles identity, redirect, JSON, empty, and stream bodies", async () => {
  const identity = new Response("identity");
  assert(commitSupabaseResponse(identity, emptyPending()) === identity);

  const pending = emptyPending();
  pending.cookies.push(cookie("sb", "token"));
  const redirect = commitSupabaseResponse(
    new Response(null, { status: 303, headers: { location: "/account" } }),
    pending,
  );
  assertEquals(redirect.status, 303);
  assertEquals(redirect.headers.get("location"), "/account");

  const json = commitSupabaseResponse(Response.json({ ok: true }), pending);
  assertEquals(await json.json(), { ok: true });

  for (const status of [204, 304]) {
    const empty = commitSupabaseResponse(
      new Response(null, { status }),
      pending,
    );
    assertEquals(empty.status, status);
    assertEquals(empty.body, null);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("streamed"));
      controller.close();
    },
  });
  const streamed = commitSupabaseResponse(new Response(stream), pending);
  assertEquals(await streamed.text(), "streamed");
});

Deno.test("scoped CSRF rejects cross-site browser mutations only", async () => {
  assert(typeof authMiddleware === "function");
  const next = () => new Response("next");
  const invoke = new App()
    .use(authMiddleware)
    .get("/auth/confirm", next)
    .post("/auth/sign-out", next)
    .post("/protected", next)
    .post("/api/webhook", next)
    .handler();

  assertEquals(
    (await invoke(
      new Request("https://app.example/auth/sign-out", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    )).status,
    403,
  );
  assertEquals(
    (await invoke(
      new Request("https://app.example/auth/sign-out", { method: "POST" }),
    )).status,
    200,
    "Fresh csrf() allows non-browser POSTs with neither fetch metadata nor Origin",
  );
  assertEquals(
    (await invoke(
      new Request("https://app.example/protected", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    )).status,
    403,
  );
  assertEquals(
    (await invoke(
      new Request("https://app.example/api/webhook", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    )).status,
    200,
    "auth CSRF scope must not change host webhooks",
  );
  assertEquals(
    (await invoke(
      new Request("https://app.example/auth/sign-out", {
        method: "POST",
        headers: { origin: "https://app.example" },
      }),
    )).status,
    200,
  );
  assertEquals(
    (await invoke(
      new Request("https://app.example/auth/confirm", {
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    )).status,
    200,
  );
});

Deno.test("auth route middleware honors Fresh basePath", async () => {
  const next = () => new Response("next");
  const invoke = new App({ basePath: "/portal" })
    .use(authMiddleware)
    .post("/auth/sign-out", next)
    .post("/protected", next)
    .handler();
  const crossSite = {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
  };
  assertEquals(
    (await invoke(
      new Request("https://app.example/portal/auth/sign-out", crossSite),
    )).status,
    403,
  );
  assertEquals(
    (await invoke(
      new Request("https://app.example/portal/protected", crossSite),
    )).status,
    403,
  );
});
