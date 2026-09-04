import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/features.css";
import "./styles/system.css";
import "./styles/feature-completion.css";
import "./styles/readability-theme.css";
import "./styles/ux-foundations.css";
import "./styles/context-menu.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
