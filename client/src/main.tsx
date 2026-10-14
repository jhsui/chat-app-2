import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ThemeProvider } from "./theme.tsx";
import { followPointerLight, pauseAmbientWhenIdle } from "./glass.ts";
import "./styles.css";

followPointerLight();
pauseAmbientWhenIdle();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
