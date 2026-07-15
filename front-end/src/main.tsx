import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "98.css";
import "./index.css";
import DM from "./pages/DM";
import Viewer from "./pages/Viewer";
import Player from "./pages/Player";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/dm" element={<DM />} />
        <Route path="/view" element={<Viewer />} />
        <Route path="/player" element={<Player />} />
        <Route path="*" element={<Navigate to="/player" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
