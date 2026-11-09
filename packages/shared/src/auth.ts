/**
 * Sign-in to the app with Supabase Auth. It is on when the API's .env names a Supabase project;
 * the web app reads this (`GET /v1/auth/config`, the one /v1 route open without a sign-in) to
 * know whether to show the login page, and builds its Supabase client from the public values.
 */
export type AuthConfig =
  | { isEnabled: false }
  | {
      isEnabled: true;
      /** e.g. https://abcd.supabase.co */
      supabaseUrl: string;
      /** The project's anon (publishable) key: public by design, it only identifies the project. */
      supabaseAnonKey: string;
    };

/** Who a request is signed in as (`GET /v1/auth/me`). */
export interface AuthUser {
  id: string;
  email: string | null;
}
