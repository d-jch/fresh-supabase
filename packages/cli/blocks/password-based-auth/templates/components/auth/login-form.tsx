export interface LoginFormProps {
  basePath: string;
  error: string | null;
  message: string | null;
  next: string;
}

export function LoginForm(
  { basePath, error, message, next }: LoginFormProps,
) {
  return (
    <div class="card w-full bg-base-100 shadow-xl">
      <div class="card-body gap-5">
        <div>
          <h1 class="card-title text-2xl">Login</h1>
          <p class="mt-1 text-sm text-base-content/70">
            Enter your email below to login to your account.
          </p>
        </div>
        {message && <div class="alert alert-success">{message}</div>}
        {error && <div class="alert alert-error" role="alert">{error}</div>}
        <form method="post" class="space-y-4">
          <input type="hidden" name="next" value={next} />
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
              autocomplete="current-password"
              required
            />
          </label>
          <button class="btn btn-primary w-full" type="submit">Login</button>
        </form>
        <nav class="flex justify-between text-sm">
          <a
            class="link link-hover"
            href={`${basePath}/auth/forgot-password`}
          >
            Forgot your password?
          </a>
          <a class="link link-hover" href={`${basePath}/auth/sign-up`}>
            Sign up
          </a>
        </nav>
      </div>
    </div>
  );
}
