import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const LOCAL_MULTIPLAYER_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export const LOCAL_DEV_MULTIPLAYER_SERVER_URL = "http://localhost:8787";

const normalizeHostname = (hostname: string) =>
  hostname.replace(/^\[(.*)\]$/, "$1");

const isLocalDevelopmentOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return LOCAL_MULTIPLAYER_HOSTNAMES.has(normalizeHostname(url.hostname));
  } catch {
    return false;
  }
};

export const resolveMultiplayerServerUrl = ({
  configuredServerUrl,
  locationOrigin
}: {
  configuredServerUrl?: string | null;
  locationOrigin?: string | null;
} = {}) => {
  const configured = configuredServerUrl?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  const origin = locationOrigin?.trim();
  if (origin && origin !== "null" && !isLocalDevelopmentOrigin(origin)) {
    return trimTrailingSlash(origin);
  }

  return LOCAL_DEV_MULTIPLAYER_SERVER_URL;
};

export const getMultiplayerServerUrl = () =>
  resolveMultiplayerServerUrl({
    configuredServerUrl: import.meta.env.VITE_SERVER_URL,
    locationOrigin:
      typeof window !== "undefined" ? window.location.origin : null
  });

export const authClient = createAuthClient({
  baseURL: `${getMultiplayerServerUrl()}/api/auth`,
  plugins: [anonymousClient()]
});
