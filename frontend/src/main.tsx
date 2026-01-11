import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./firebase"; // Initialize Firebase

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);