import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SupportProvider } from "@cossistant/react";
import "@cossistant/react/styles.css";
import { SupportApp } from "./app/SupportApp";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <SupportProvider publicKey={import.meta.env.VITE_COSSISTANT_API_KEY}>
      <SupportApp />
    </SupportProvider>
  </StrictMode>
);
