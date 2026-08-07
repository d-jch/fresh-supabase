export interface UpdatePasswordFormProps {
  error: string | null;
}

export function UpdatePasswordForm({ error }: UpdatePasswordFormProps) {
  return (
    <div class="card w-full bg-base-100 shadow-xl">
      <div class="card-body gap-5">
        <div>
          <h1 class="card-title text-2xl">Reset your password</h1>
          <p class="mt-1 text-sm text-base-content/70">
            Enter your new password below.
          </p>
        </div>
        {error && <div class="alert alert-error" role="alert">{error}</div>}
        <form method="post" class="space-y-4">
          <label class="form-control w-full">
            <span class="label-text mb-1">New password</span>
            <input
              class="input input-bordered w-full"
              type="password"
              name="password"
              autocomplete="new-password"
              required
            />
          </label>
          <button class="btn btn-primary w-full" type="submit">
            Save new password
          </button>
        </form>
      </div>
    </div>
  );
}
