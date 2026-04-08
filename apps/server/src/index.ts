import { websocket } from "./app";
import { bootstrapServerApp } from "./bootstrap";
import { readRuntimeEnv } from "./runtime";

const env = readRuntimeEnv();
const runtimeApp = await bootstrapServerApp(env);

export default {
  port: env.port,
  fetch: runtimeApp.app.fetch,
  websocket
};
