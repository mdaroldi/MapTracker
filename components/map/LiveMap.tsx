"use client";

/**
 * LiveMap — full-screen interactive fleet map
 *
 * Stack:
 *   MapLibre GL JS   — base OSM map (OpenFreemap tiles, no API key)
 *   @deck.gl/mapbox  — MapboxOverlay adds deck.gl layers into MapLibre's
 *                      WebGL context so they share the same camera
 *   ScatterplotLayer — one coloured dot per vehicle
 *   Supabase Realtime — postgres_changes INSERT on "Position" table for
 *                       live position updates
 *
 * ── Supabase Realtime setup required ────────────────────────────────────────
 * Run this SQL once in Supabase Dashboard → SQL Editor:
 *
 *   ALTER PUBLICATION supabase_realtime ADD TABLE "Position";
 *
 * Without it the initial positions load fine, but the map won't update live.
 * Optionally also disable RLS (fine for the MVP demo):
 *
 *   ALTER TABLE "Position" DISABLE ROW LEVEL SECURITY;
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { createClient } from "@/lib/supabase/client";
import type { VehiclePositionData } from "@/app/api/positions/route";
import { dotColor, dotRadius } from "@/lib/vehicle-display";

// ── Types ─────────────────────────────────────────────────────────────────────

type PositionMap = Map<string, VehiclePositionData>;

// Supabase Realtime row shape (column names match Prisma camelCase fields)
interface PositionRow {
  id: string;
  vehicleId: string;
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  engineOn: boolean;
  createdAt: string;
}

// ── Map style ─────────────────────────────────────────────────────────────────
// OpenFreemap — free, no API key, MapLibre-native style.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// Stockholm city centre
const INITIAL_VIEW = { center: [18.0686, 59.3293] as [number, number], zoom: 10 };

// ── Component ─────────────────────────────────────────────────────────────────

export default function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const overlayRef   = useRef<MapboxOverlay | null>(null);
  // vehicleMetaRef holds registration+type so Realtime updates can merge them
  const vehicleMetaRef = useRef<Map<string, Pick<VehiclePositionData, "registration" | "type">>>(new Map());

  const [positions, setPositions]         = useState<PositionMap>(new Map());
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [tooltip, setTooltip]             = useState<{ x: number; y: number; vehicle: VehiclePositionData } | null>(null);

  // ── Update deck.gl overlay whenever positions state changes ───────────────
  const updateLayers = useCallback((posMap: PositionMap) => {
    if (!overlayRef.current) return;
    const data = Array.from(posMap.values());

    const scatterLayer = new ScatterplotLayer<VehiclePositionData>({
      id: "vehicles-scatter",
      data,
      getPosition: (d) => [d.lng, d.lat],
      getRadius:   (d) => dotRadius(d),
      getFillColor: (d) => dotColor(d),
      radiusUnits: "meters",
      pickable: true,
      onClick: (info) => {
        // Deselect on second click
        if (info.object && tooltip?.vehicle.vehicleId === info.object.vehicleId) {
          setTooltip(null);
        } else if (info.object) {
          setTooltip({ x: info.x, y: info.y, vehicle: info.object });
        }
      },
      onHover: (info) => {
        if (info.object) {
          setTooltip({ x: info.x, y: info.y, vehicle: info.object });
        } else {
          setTooltip(null);
        }
      },
      updateTriggers: { getFillColor: data, getRadius: data },
    });

    const textLayer = new TextLayer<VehiclePositionData>({
      id: "vehicles-labels",
      data,
      getPosition:   (d) => [d.lng, d.lat],
      getText:       (d) => d.registration,
      getSize:       11,
      getColor:      [30, 30, 30, 200],
      getPixelOffset: [0, -22],
      fontFamily:    "Inter, system-ui, sans-serif",
      fontWeight:    "600",
      background:    true,
      getBackgroundColor: [255, 255, 255, 180],
      backgroundPadding: [3, 1, 3, 1],
    });

    overlayRef.current.setProps({ layers: [scatterLayer, textLayer] });
  }, [tooltip]);

  // ── Initialise MapLibre + overlay once on mount ───────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const el = containerRef.current;
    console.log("[map] container dimensions:", el.clientWidth, "x", el.clientHeight);

    const map = new maplibregl.Map({
      container: el,
      style:     MAP_STYLE,
      center:    INITIAL_VIEW.center,
      zoom:      INITIAL_VIEW.zoom,
      attributionControl: false,
    });

    map.on("error", (e) => console.error("[map] error:", e.error));

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // Add the deck.gl overlay after the style loads
    map.on("load", () => {
      console.log("[map] style loaded, canvas:", map.getCanvas().width, "x", map.getCanvas().height);
      map.resize();

      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: [],
      });
      map.addControl(overlay as unknown as maplibregl.IControl);
      overlayRef.current = overlay;

      // Render any positions that arrived before the map was ready
      setPositions((prev) => {
        updateLayers(prev);
        return prev;
      });
    });

    mapRef.current = map;

    return () => {
      if (overlayRef.current) {
        overlayRef.current.finalize();
        overlayRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-render layers whenever positions change ────────────────────────────
  useEffect(() => {
    updateLayers(positions);
  }, [positions, updateLayers]);

  // ── Load initial positions from the API ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/positions")
      .then((r) => r.json())
      .then((json: { data: VehiclePositionData[] | null; error: string | null }) => {
        if (cancelled || !json.data) return;
        const map = new Map<string, VehiclePositionData>();
        for (const v of json.data) {
          map.set(v.vehicleId, v);
          vehicleMetaRef.current.set(v.vehicleId, {
            registration: v.registration,
            type:         v.type,
          });
        }
        setPositions(map);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, []);

  // ── Supabase Realtime subscription ───────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("positions-live", { config: { broadcast: { ack: false } } })
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          // Table name matches the Prisma model name (PascalCase, no @@map)
          table:  "Position",
        },
        (payload) => {
          const row = payload.new as PositionRow;
          const meta = vehicleMetaRef.current.get(row.vehicleId);
          setPositions((prev) => {
            const next = new Map(prev);
            next.set(row.vehicleId, {
              vehicleId:    row.vehicleId,
              registration: meta?.registration ?? row.vehicleId.slice(0, 8),
              type:         meta?.type         ?? "truck",
              lat:          row.lat,
              lng:          row.lng,
              heading:      row.heading,
              speedKmh:     row.speedKmh,
              engineOn:     row.engineOn,
            });
            return next;
          });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED")  setRealtimeStatus("live");
        if (status === "CHANNEL_ERROR") setRealtimeStatus("error");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Derived counts for the status bar ────────────────────────────────────
  const all      = Array.from(positions.values());
  const active   = all.filter((v) => v.engineOn && v.speedKmh >= 1).length;
  const idle     = all.filter((v) => v.engineOn && v.speedKmh < 1).length;
  const offline  = all.filter((v) => !v.engineOn).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-[calc(100vh-4rem)] w-full overflow-hidden rounded-xl">

      {/* Map canvas — must have explicit block dimensions so MapLibre reads the
          correct clientWidth/clientHeight when it initialises the WebGL canvas.
          absolute inset-0 alone can yield clientHeight=0 in some environments. */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* ── Top-left status bar ── */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur-sm ring-1 ring-black/5">
        <h1 className="text-sm font-semibold text-slate-900">Live Map</h1>
        <span className="h-4 w-px bg-slate-200" />

        {/* Realtime indicator */}
        <div className="flex items-center gap-1.5">
          <span
            className={[
              "inline-block h-2 w-2 rounded-full",
              realtimeStatus === "live"       ? "bg-emerald-500 animate-pulse" :
              realtimeStatus === "error"      ? "bg-red-500" :
              "bg-amber-400 animate-pulse",
            ].join(" ")}
          />
          <span className="text-xs text-slate-500">
            {realtimeStatus === "live"  ? "Live"  :
             realtimeStatus === "error" ? "Realtime error" :
             "Connecting…"}
          </span>
        </div>

        <span className="h-4 w-px bg-slate-200" />

        {/* Vehicle counts */}
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-medium text-slate-700">{active}</span>
            <span className="text-slate-400">moving</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="font-medium text-slate-700">{idle}</span>
            <span className="text-slate-400">idle</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="font-medium text-slate-700">{offline}</span>
            <span className="text-slate-400">offline</span>
          </span>
        </div>
      </div>

      {/* ── Hover/click tooltip ── */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 min-w-[160px] rounded-lg bg-white/95 px-3 py-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 48 }}
        >
          <p className="text-sm font-semibold text-slate-900">
            {tooltip.vehicle.registration}
          </p>
          <p className="text-xs capitalize text-slate-500">{tooltip.vehicle.type}</p>
          <div className="mt-1.5 space-y-0.5 text-xs text-slate-600">
            <div className="flex justify-between gap-4">
              <span>Speed</span>
              <span className="font-medium">{tooltip.vehicle.speedKmh.toFixed(0)} km/h</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Heading</span>
              <span className="font-medium">{tooltip.vehicle.heading.toFixed(0)}°</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Engine</span>
              <span className={tooltip.vehicle.engineOn ? "font-medium text-emerald-600" : "font-medium text-slate-400"}>
                {tooltip.vehicle.engineOn ? "On" : "Off"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom-right legend ── */}
      <div className="absolute bottom-8 right-3 z-10 rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur-sm ring-1 ring-black/5">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Legend
        </p>
        {[
          { color: "bg-emerald-500", label: "Moving" },
          { color: "bg-amber-400",  label: "Idle (engine on)" },
          { color: "bg-slate-400",  label: "Offline" },
        ].map(({ color, label }: { color: string; label: string }) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
            <span className="text-xs text-slate-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
