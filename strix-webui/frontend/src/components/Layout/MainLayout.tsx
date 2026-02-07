import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { useWebSocket } from "../../hooks/useWebSocket";

export default function MainLayout() {
  const { status } = useWebSocket();

  return (
    <div className="flex h-screen bg-strix-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header connectionStatus={status} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
