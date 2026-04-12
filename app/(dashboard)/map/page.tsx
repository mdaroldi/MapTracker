"use client";

import dynamic from "next/dynamic";

// MapLibre GL and deck.gl reference browser APIs at module evaluation time.
// `ssr: false` prevents them from running during server-side rendering.
// The containing page must be a Client Component for `ssr: false` to be valid
// in Next.js 15.
const LiveMap = dynamic(() => import("@/components/map/LiveMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center rounded-xl bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
        <p className="text-sm text-slate-500">Loading map…</p>
      </div>
    </div>
  ),
});

export default function MapPage() {
  return <LiveMap />;
}
