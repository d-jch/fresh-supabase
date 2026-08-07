import { scopedAuthCsrf, supabaseSession } from "@/lib/supabase/middleware.ts";

export default [scopedAuthCsrf, supabaseSession];
