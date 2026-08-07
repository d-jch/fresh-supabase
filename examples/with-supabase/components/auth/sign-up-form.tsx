export interface SignUpFormProps {
  basePath: string;
  error: string | null;
}

export function SignUpForm({ basePath, error }: SignUpFormProps) {
  return (
    <div class="card w-full bg-base-100 shadow-xl">
      <div class="card-body gap-5">
        <div>
          <h1 class="card-title text-2xl">Sign up</h1>
          <p class="mt-1 text-sm text-base-content/70">Create a new account.</p>
        </div>
        {error && <div class="alert alert-error" role="alert">{error}</div>}
        <form method="post" class="space-y-4">
          <label class="form-control w-full">
            <span class="label-text mb-1">Email</span>
            <input
              class="input input-bordered w-full"
              type="email"
              name="email"
              autocomplete="email"
              required
            />
          </label>
          <label class="form-control w-full">
            <span class="label-text mb-1">Password</span>
            <input
              class="input input-bordered w-full"
              type="password"
              name="password"
              autocomplete="new-password"
              required
            />
          </label>
          <label class="form-control w-full">
            <span class="label-text mb-1">Repeat password</span>
            <input
              class="input input-bordered w-full"
              type="password"
              name="repeat-password"
              autocomplete="new-password"
              required
            />
          </label>
          <button class="btn btn-primary w-full" type="submit">
            Create account
          </button>
        </form>
        <a class="link link-hover text-sm" href={`${basePath}/auth/login`}>
          Already have an account? Login
        </a>
      </div>
    </div>
  );
}
