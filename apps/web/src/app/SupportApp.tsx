import { Support, useSupport } from "@cossistant/react";
import { App } from "./App";

const hiddenSupportTriggerClassName = "support-launcher-anchor";

export function SupportApp() {
  const { open } = useSupport();

  return (
    <>
      <App onOpenSupportWidget={open} />
      <Support classNames={{ trigger: hiddenSupportTriggerClassName }} />
    </>
  );
}
