import type { User } from "@supabase/supabase-js";
import type { PendingSupabaseChanges } from "./server.ts";
import { createSupabaseServerClient } from "./server.ts";

export interface SupabaseAuthState extends Record<string, unknown> {
  supabaseUser: User;
}

export interface RequestUserResult {
  user: User | null;
  pending: PendingSupabaseChanges;
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
