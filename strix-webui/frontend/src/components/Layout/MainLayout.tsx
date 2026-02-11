import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import MobileDrawer from "./MobileDrawer";
import EdgeSwipeNav from "./EdgeSwipeNav";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useIsMobile } from "../../hooks/useIsMobile";

export default function MainLayout() {
  const { status } = useWebSocket();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-strix-bg overflow-hidden">
      {isMobile ? (
        <MobileDrawer isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} side="left" width="w-72">
          <Sidebar onNavClick={() => setSidebarOpen(false)} />
        </MobileDrawer>
      ) : (
        <Sidebar />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          connectionStatus={status}
          showMenu={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      {isMobile && <EdgeSwipeNav disabled={sidebarOpen} />}
    </div>
  );
}
