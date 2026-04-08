import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const getMultiplayerServerUrl = () => {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  if (typeof window !== "undefined" && window.location.origin) {
    return trimTrailingSlash(window.location.origin);
  }

  return "";
};

export const authClient = createAuthClient({
  baseURL: `${getMultiplayerServerUrl()}/api/auth`,
  plugins: [anonymousClient()]
});
