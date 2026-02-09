import { Routes, Route } from "react-router-dom";
import MainLayout from "./components/Layout/MainLayout";
import { WebSocketProvider } from "./hooks/useWebSocket";
import Dashboard from "./pages/Dashboard";
import LiveScan from "./pages/LiveScan";
import ScanHistory from "./pages/ScanHistory";
import Reports from "./pages/Reports";
import ReportPreview from "./pages/ReportPreview";
import Settings from "./pages/Settings";
import ToolCategory from "./pages/ToolCategory";
import Findings from "./pages/Findings";
import AskAI from "./pages/AskAI";

export default function App() {
  return (
    <WebSocketProvider>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ask" element={<AskAI />} />
          <Route path="/scan" element={<LiveScan />} />
          <Route path="/scan/:id" element={<LiveScan />} />
          <Route path="/scan/:id/report" element={<ReportPreview />} />
          <Route path="/history" element={<ScanHistory />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tools/:category" element={<ToolCategory />} />
        </Route>
      </Routes>
    </WebSocketProvider>
  );
}
