"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/nav/Navbar";
import BottomTabs from "@/components/nav/BottomTabs";

/**
 * Conditionally renders the Navbar, main content wrapper, and BottomTabs.
 *
 * On /stream/* routes, all chrome is stripped for OBS/streaming overlays.
 * The children are rendered directly without any padding or navigation.
 */
export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isStreamRoute = pathname.startsWith("/stream");

  if (isStreamRoute) {
    // No navbar, no bottom tabs, no padding -- pure overlay
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      {/* pb-20 on mobile to account for fixed bottom tab bar */}
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 md:pb-8">
        {children}
      </main>
      <BottomTabs />
    </>
  );
}
