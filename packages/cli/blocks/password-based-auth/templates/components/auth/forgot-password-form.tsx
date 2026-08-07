export interface ForgotPasswordFormProps {
  basePath: string;
  error: string | null;
  success: boolean;
}

export function ForgotPasswordForm(
  { basePath, error, success }: ForgotPasswordFormProps,
) {
  if (success) {
    return (
      <div class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-3">
          <h1 class="card-title text-2xl">Check your email</h1>
          <p class="text-sm text-base-content/70">
            Password reset instructions were sent if that account exists.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div class="card w-full bg-base-100 shadow-xl">
      <div class="card-body gap-5">
        <div>
          <h1 class="card-title text-2xl">Reset your password</h1>
          <p class="mt-1 text-sm text-base-content/70">
            Enter your email and we'll send a reset link.
          </p>
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
          <button class="btn btn-primary w-full" type="submit">
            Send reset email
          </button>
        </form>
        <a class="link link-hover text-sm" href={`${basePath}/auth/login`}>
          Back to login
        </a>
      </div>
    </div>
  );
}
