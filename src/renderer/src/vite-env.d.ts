/// <reference types="vite/client" />

import type { JProgrammerApi } from "../../preload";

declare global {
  interface Window {
    jprogrammer: JProgrammerApi;
  }
}
