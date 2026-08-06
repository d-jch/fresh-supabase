import passwordAuthRequireUser from "../blocks/password-based-auth/templates/lib/supabase/require_user.ts" with {
  type: "text",
};
import passwordAuthRedirect from "../blocks/password-based-auth/templates/lib/supabase/redirect.ts" with {
  type: "text",
};
import passwordAuthMiddleware from "../blocks/password-based-auth/templates/routes/(auth)/_middleware.ts" with {
  type: "text",
};
import passwordAuthConfirm from "../blocks/password-based-auth/templates/routes/(auth)/auth/confirm.ts" with {
  type: "text",
};
import passwordAuthForgotPassword from "../blocks/password-based-auth/templates/routes/(auth)/auth/forgot-password.tsx" with {
  type: "text",
};
import passwordAuthSignIn from "../blocks/password-based-auth/templates/routes/(auth)/auth/sign-in.tsx" with {
  type: "text",
};
import passwordAuthSignOut from "../blocks/password-based-auth/templates/routes/(auth)/auth/sign-out.ts" with {
  type: "text",
};
import passwordAuthSignUp from "../blocks/password-based-auth/templates/routes/(auth)/auth/sign-up.tsx" with {
  type: "text",
};
import passwordAuthUpdatePassword from "../blocks/password-based-auth/templates/routes/(auth)/auth/update-password.tsx" with {
  type: "text",
};
import passwordAuthProtectedMiddleware from "../blocks/password-based-auth/templates/routes/(protected)/_middleware.ts" with {
  type: "text",
};
import passwordAuthAccount from "../blocks/password-based-auth/templates/routes/(protected)/account.tsx" with {
  type: "text",
};
import passwordAuthConfirmationEmail from "../blocks/password-based-auth/templates/supabase/confirmation.html" with {
  type: "text",
};
import passwordAuthRecoveryEmail from "../blocks/password-based-auth/templates/supabase/recovery.html" with {
  type: "text",
};
import supabaseClientBrowser from "../blocks/supabase-client/templates/lib/supabase/client.ts" with {
  type: "text",
};
import supabaseClientEnv from "../blocks/supabase-client/templates/lib/supabase/env.ts" with {
  type: "text",
};
import supabaseClientResponse from "../blocks/supabase-client/templates/lib/supabase/response.ts" with {
  type: "text",
};
import supabaseClientServer from "../blocks/supabase-client/templates/lib/supabase/server.ts" with {
  type: "text",
};

const embeddedTemplates = new Map<string, ReadonlyMap<string, string>>([
  [
    "supabase-client",
    new Map([
      ["templates/lib/supabase/client.ts", supabaseClientBrowser],
      ["templates/lib/supabase/env.ts", supabaseClientEnv],
      ["templates/lib/supabase/response.ts", supabaseClientResponse],
      ["templates/lib/supabase/server.ts", supabaseClientServer],
    ]),
  ],
  [
    "password-based-auth",
    new Map([
      ["templates/lib/supabase/redirect.ts", passwordAuthRedirect],
      ["templates/lib/supabase/require_user.ts", passwordAuthRequireUser],
      ["templates/routes/(auth)/_middleware.ts", passwordAuthMiddleware],
      [
        "templates/routes/(auth)/auth/confirm.ts",
        passwordAuthConfirm,
      ],
      [
        "templates/routes/(auth)/auth/forgot-password.tsx",
        passwordAuthForgotPassword,
      ],
      [
        "templates/routes/(auth)/auth/sign-in.tsx",
        passwordAuthSignIn,
      ],
      [
        "templates/routes/(auth)/auth/sign-out.ts",
        passwordAuthSignOut,
      ],
      [
        "templates/routes/(auth)/auth/sign-up.tsx",
        passwordAuthSignUp,
      ],
      [
        "templates/routes/(auth)/auth/update-password.tsx",
        passwordAuthUpdatePassword,
      ],
      [
        "templates/routes/(protected)/_middleware.ts",
        passwordAuthProtectedMiddleware,
      ],
      [
        "templates/routes/(protected)/account.tsx",
        passwordAuthAccount,
      ],
      [
        "templates/supabase/confirmation.html",
        passwordAuthConfirmationEmail,
      ],
      ["templates/supabase/recovery.html", passwordAuthRecoveryEmail],
    ]),
  ],
]);

export function getEmbeddedTemplate(
  blockName: string,
  templatePath: string,
): string | undefined {
  return embeddedTemplates.get(blockName)?.get(templatePath);
}

export function listEmbeddedTemplateKeys(): string[] {
  return [...embeddedTemplates.entries()].flatMap(([blockName, templates]) =>
    [...templates.keys()].map((templatePath) => `${blockName}/${templatePath}`)
  ).sort();
}
