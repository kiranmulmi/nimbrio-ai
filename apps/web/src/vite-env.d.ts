/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API, e.g. `http://localhost:4000`. Empty means the page's own origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
