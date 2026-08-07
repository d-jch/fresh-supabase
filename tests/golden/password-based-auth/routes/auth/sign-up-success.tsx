import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";

export default define.page(() => (
  <>
    <Head>
      <title>Check your email</title>
    </Head>
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <section class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-3">
          <h1 class="card-title text-2xl">Thank you for signing up!</h1>
          <p class="text-sm text-base-content/70">
            Check your email to confirm your account before logging in.
          </p>
        </div>
      </section>
    </main>
  </>
));
