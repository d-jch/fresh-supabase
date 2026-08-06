import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, assertEquals } from "../unit/assert.ts";
import { withTestProject } from "../unit/test_project.ts";

const decoder = new TextDecoder();

function contentType(path: string): string {
  switch (extname(path)) {
    case ".ts":
    case ".tsx":
      return "application/typescript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

Deno.test("the CLI installs when its module graph is loaded over HTTP", async () => {
  const packageRoot = fileURLToPath(
    new URL("../../packages/cli/", import.meta.url),
  );
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    async (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (!/^\/[A-Za-z0-9_./()\-]+$/.test(pathname)) {
        return new Response("Not found", { status: 404 });
      }
      try {
        const content = await Deno.readFile(
          join(packageRoot, ...pathname.slice(1).split("/")),
        );
        return new Response(content, {
          headers: { "content-type": contentType(pathname) },
        });
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return new Response("Not found", { status: 404 });
        }
        throw error;
      }
    },
  );

  try {
    await withTestProject({}, async (root) => {
      const address = server.addr as Deno.NetAddr;
      const origin = `127.0.0.1:${address.port}`;
      const output = await new Deno.Command(Deno.execPath(), {
        cwd: root,
        args: [
          "run",
          "--no-config",
          "--no-lock",
          `--allow-import=${origin}`,
          "--allow-read",
          "--allow-write",
          `http://${origin}/main.ts`,
          "add",
          "supabase-client",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(
        output.code,
        0,
        `remote CLI failed:\n${decoder.decode(output.stderr)}`,
      );
      assert(
        decoder.decode(output.stdout).includes("Installed supabase-client"),
        "remote CLI did not report an installation",
      );
      assert(
        (await Deno.stat(join(root, "lib", "supabase", "server.ts"))).isFile,
        "remote CLI did not copy the embedded template",
      );
    });
  } finally {
    await server.shutdown();
  }
});
