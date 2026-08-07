import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";

interface ErrorData {
  error: string | null;
}

export const handler = define.handlers({
  GET(ctx) {
    return page<ErrorData>({ error: ctx.url.searchParams.get("error") });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <>
    <Head>
      <title>Authentication error</title>
    </Head>
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <section class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-3">
          <h1 class="card-title text-2xl">Sorry, something went wrong.</h1>
          <p class="text-sm text-base-content/70">
            {data.error
              ? `Code error: ${data.error}`
              : "An unspecified error occurred."}
          </p>
        </div>
      </section>
    </main>
  </>
));
