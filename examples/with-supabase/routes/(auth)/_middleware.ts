import { csrf } from "fresh";
import { define } from "../../utils.ts";

// Scope browser CSRF protection to the auth routes instead of installing it
// globally, so unrelated webhook and machine API route groups stay unaffected.
export default define.middleware(csrf());
