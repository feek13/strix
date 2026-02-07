import { Routes, Route } from "react-router-dom";
import MainLayout from "./components/Layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import LiveScan from "./pages/LiveScan";
import ScanHistory from "./pages/ScanHistory";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import ToolCategory from "./pages/ToolCategory";
import Findings from "./pages/Findings";

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scan" element={<LiveScan />} />
        <Route path="/scan/:id" element={<LiveScan />} />
        <Route path="/history" element={<ScanHistory />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/findings" element={<Findings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/tools/:category" element={<ToolCategory />} />
      </Route>
    </Routes>
  );
}
