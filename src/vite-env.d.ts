/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Dev builds: a local opencode-composio checkout for agent machines to load instead of the published plugin. */
  readonly VITE_COMPOSIO_PLUGIN?: string;
}
