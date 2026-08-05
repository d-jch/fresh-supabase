import type { User } from "@supabase/supabase-js";
import type { PendingSupabaseChanges } from "./server.ts";
import { createSupabaseServerClient } from "./server.ts";

export interface RequestUserResult {
  user: User | null;
  pending: PendingSupabaseChanges;
}

/** Attach the verified user without requiring an edit to the app's State type. */
export function setSupabaseUser(state: object, user: User): void {
  Reflect.set(state, "supabaseUser", user);
}

/** Read the user attached by the protected route middleware. */
export function getSupabaseUser(state: object): User {
  const user = Reflect.get(state, "supabaseUser") as User | undefined;
  if (user === undefined) {
    throw new Error("Protected route state does not contain a Supabase user");
  }
  return user;
}

/** Validate the current request's user with Supabase Auth. */
export async function requireRequestUser(
  request: Request,
): Promise<RequestUserResult> {
  const { supabase, pending } = createSupabaseServerClient(request);
  const { data, error } = await supabase.auth.getUser();
  return {
    user: error ? null : data.user,
    pending,
  };
}
