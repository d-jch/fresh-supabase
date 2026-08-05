import { join } from "node:path";
import { pathToFileURL } from "node:url";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `expected ${expected}, received ${actual}`);
  }
}

const projectRoot = Deno.env.get("GENERATED_PROJECT_ROOT");
if (!projectRoot) throw new Error("GENERATED_PROJECT_ROOT is required");

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "person@example.com",
  email_confirmed_at: "2026-08-05T00:00:00.000Z",
  phone: "",
  confirmed_at: "2026-08-05T00:00:00.000Z",
  last_sign_in_at: "2026-08-05T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
  is_anonymous: false,
};
const SESSION = {
  access_token: "test-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  refresh_token: "test-refresh-token",
  user: USER,
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0])
    .join("; ");
}

function requestHeaders(cookie = ""): Headers {
  const headers = new Headers({
    origin: "http://app.example",
    "sec-fetch-site": "same-origin",
  });
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

Deno.test({
  name:
    "built password auth completes server-first flows against Supabase HTTP",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const calls: string[] = [];
    const authServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async (request) => {
        const url = new URL(request.url);
        const body = await request.text();
        calls.push(`${request.method} ${url.pathname}${url.search} ${body}`);

        if (
          request.method === "POST" && url.pathname === "/auth/v1/token" &&
          url.searchParams.get("grant_type") === "password"
        ) {
          return json(SESSION);
        }
        if (request.method === "POST" && url.pathname === "/auth/v1/signup") {
          return json(SESSION);
        }
        if (request.method === "POST" && url.pathname === "/auth/v1/recover") {
          return json({});
        }
        if (request.method === "POST" && url.pathname === "/auth/v1/verify") {
          return json(SESSION);
        }
        if (url.pathname === "/auth/v1/user" && request.method === "GET") {
          return request.headers.get("authorization") ===
              `Bearer ${SESSION.access_token}`
            ? json(USER)
            : json({ code: 401, msg: "invalid JWT" }, 401);
        }
        if (url.pathname === "/auth/v1/user" && request.method === "PUT") {
          return json(USER);
        }
        if (url.pathname === "/auth/v1/logout" && request.method === "POST") {
          return new Response(null, { status: 204 });
        }
        return json({
          message: `unexpected fake endpoint: ${request.method} ${url}`,
        }, 404);
      },
    );

    try {
      const address = authServer.addr as Deno.NetAddr;
      Deno.env.set(
        "FRESH_PUBLIC_SUPABASE_URL",
        `http://${address.hostname}:${address.port}`,
      );
      Deno.env.set(
        "FRESH_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "test-publishable-key",
      );
      const entry =
        pathToFileURL(join(projectRoot, "_fresh", "server.js")).href;
      const app = (await import(entry)).default as {
        fetch(request: Request): Response | Promise<Response>;
      };
      const invoke = (path: string, init?: RequestInit) =>
        app.fetch(new Request(`http://app.example${path}`, init));
      const submit = (
        path: string,
        fields: Record<string, string>,
        cookie = "",
      ) =>
        invoke(path, {
          method: "POST",
          headers: requestHeaders(cookie),
          body: new URLSearchParams(fields),
        });

      const anonymous = await invoke("/account");
      assertEquals(anonymous.status, 303);
      assert(
        anonymous.headers.get("location")?.startsWith("/auth/sign-in?next="),
        "anonymous account request should redirect to sign-in",
      );

      const signIn = await submit("/auth/sign-in", {
        email: USER.email,
        password: "correct-horse-battery-staple",
        next: "/account?tab=security",
      });
      assertEquals(signIn.status, 303);
      assertEquals(signIn.headers.get("location"), "/account?tab=security");
      const sessionCookie = cookieHeader(signIn);
      assert(sessionCookie.length > 0, "sign-in should commit session cookies");

      const account = await invoke("/account", {
        headers: requestHeaders(sessionCookie),
      });
      assertEquals(account.status, 200);
      assert(
        (await account.text()).includes(USER.email),
        "protected account should render the verified user",
      );

      const signUp = await submit("/auth/sign-up", {
        email: "new@example.com",
        password: "new-password",
      });
      assertEquals(signUp.status, 303);
      assertEquals(signUp.headers.get("location"), "/account");
      assert(
        cookieHeader(signUp).length > 0,
        "sign-up should commit a session",
      );

      const forgot = await submit("/auth/forgot-password", {
        email: USER.email,
      });
      assertEquals(forgot.status, 303);
      assertEquals(
        forgot.headers.get("location"),
        "/auth/sign-in?message=reset-email",
      );

      const confirmation = await invoke(
        "/auth/confirm?token_hash=recovery-token&type=recovery",
      );
      assertEquals(confirmation.status, 303);
      assertEquals(
        confirmation.headers.get("location"),
        "/auth/update-password",
      );
      const recoveryCookie = cookieHeader(confirmation);
      assert(recoveryCookie.length > 0, "confirmation should commit a session");

      const update = await submit(
        "/auth/update-password",
        { password: "updated-password" },
        recoveryCookie,
      );
      assertEquals(update.status, 303);
      assertEquals(update.headers.get("location"), "/account");

      const signOut = await submit("/auth/sign-out", {}, sessionCookie);
      assertEquals(signOut.status, 303);
      assertEquals(signOut.headers.get("location"), "/auth/sign-in");
      assert(
        cookieHeader(signOut).length > 0,
        "sign-out should commit cleared session cookies",
      );

      for (
        const endpoint of [
          "POST /auth/v1/token?grant_type=password",
          "GET /auth/v1/user",
          "POST /auth/v1/signup",
          "POST /auth/v1/recover",
          "POST /auth/v1/verify",
          "PUT /auth/v1/user",
          "POST /auth/v1/logout",
        ]
      ) {
        assert(
          calls.some((call) => call.startsWith(endpoint)),
          `missing Supabase call: ${endpoint}\n${calls.join("\n")}`,
        );
      }
    } finally {
      await authServer.shutdown();
    }
  },
});
