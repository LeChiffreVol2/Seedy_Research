"use client";

import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Camera,
  ChevronDown,
  CheckCircle2,
  ClipboardCheck,
  CloudRain,
  Crosshair,
  DatabaseZap,
  FileText,
  GitCompareArrows,
  HelpCircle,
  Layers,
  ListChecks,
  MapPinned,
  Maximize2,
  Menu,
  Minus,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Ruler,
  Search,
  SearchCheck,
  Settings,
  ShieldAlert,
  TrainFront,
  TrafficCone,
  TrendingUp,
  TriangleAlert,
  UserCircle,
  WifiOff,
  X,
} from "lucide-react";
import type { FeatureCollection } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { envelopeMapCommands, executeMapCommand, type OpsMapCommandState } from "@/lib/map-command-executor";
import type {
  ActionProposal,
  AnalystBrief,
  OntologyReadModel,
  OpsLayerRegistryResponse,
  OpsMapCommand,
  OpsMapCommandEnvelope,
  OpsOverview,
  OpsSourceSlaResponse,
  RailActionProposal,
  RailActionRecord,
  RailOverview,
  RailResearchWorkflowResponse,
  RailSafetyCase,
  ResearchGateFinding,
  ResearchGateProposal,
  ResearchGateResponse,
  ResearchQuestion,
  ResearchWorkflowResponse,
  SmartCityActionRecord,
  SmartCityEvent,
  SmartCityHotspot,
  SmartCityInsight,
  SmartCityOntologyObject,
  SourceHealth,
} from "@/lib/types";

type LayerKey = "incidents" | "hotspots" | "cameras" | "congestion" | "weather" | "roadworks" | "osiris" | "rail";

type LayerState = Record<LayerKey, boolean>;

type WorkspaceKey =
  | "overview"
  | "incidents"
  | "hotspots"
  | "cameras"
  | "weather"
  | "congestion"
  | "roadworks"
  | "assets"
  | "reports"
  | "analytics"
  | "alerts"
  | "settings";

type ToolKey = "search" | "measure" | "draw" | "bookmarks" | "layers";

type PopoverKey = "region" | "alerts" | "help" | "user" | "command" | "tool" | null;

type DockTab = "dossier" | "analyst" | "sources" | "actions";

const DEFAULT_LAYERS: LayerState = {
  incidents: true,
  hotspots: true,
  cameras: true,
  congestion: true,
  weather: true,
  roadworks: true,
  osiris: true,
  rail: true,
};

const REALTIME_REFRESH_INTERVAL_MS = 60_000;

const LAYER_LABELS: Record<LayerKey, { label: string; icon: typeof TriangleAlert }> = {
  incidents: { label: "Live incidents", icon: TriangleAlert },
  hotspots: { label: "Hotspots", icon: ShieldAlert },
  cameras: { label: "Cameras", icon: Camera },
  congestion: { label: "Congestion", icon: TrafficCone },
  weather: { label: "Weather risk", icon: CloudRain },
  roadworks: { label: "Road works", icon: TrafficCone },
  osiris: { label: "Osiris global", icon: DatabaseZap },
  rail: { label: "SRT crossings", icon: TrainFront },
};

const WORKSPACE_META: Record<WorkspaceKey, { label: string; icon: typeof TriangleAlert }> = {
  overview: { label: "Overview", icon: BarChart3 },
  incidents: { label: "Live incidents", icon: TriangleAlert },
  hotspots: { label: "Hotspots", icon: MapPinned },
  cameras: { label: "Cameras", icon: Camera },
  weather: { label: "Weather risk", icon: CloudRain },
  congestion: { label: "Congestion", icon: TrafficCone },
  roadworks: { label: "Road works", icon: TriangleAlert },
  assets: { label: "Assets", icon: DatabaseZap },
  reports: { label: "Reports", icon: FileText },
  analytics: { label: "Analytics", icon: BarChart3 },
  alerts: { label: "Alerts", icon: Bell },
  settings: { label: "Settings", icon: Settings },
};

const TOOL_META: Record<ToolKey, { label: string; icon: typeof Search }> = {
  search: { label: "Search", icon: Search },
  measure: { label: "Measure", icon: Ruler },
  draw: { label: "Draw", icon: Pencil },
  bookmarks: { label: "Bookmarks", icon: MapPinned },
  layers: { label: "Layers", icon: Layers },
};

const COMPACT_LAYER_LABELS: Record<LayerKey, string> = {
  incidents: "Incidents",
  hotspots: "Hotspots",
  cameras: "CCTV",
  congestion: "Traffic",
  weather: "Weather",
  roadworks: "Works",
  osiris: "Osiris",
  rail: "Rail",
};

type TopStats = {
  liveIncidents: number;
  weatherRisk: string;
  weatherSeverity: SmartCityEvent["severity"] | "none";
  activeSources: number;
  totalSources: number;
  hotspotCount: number;
  cameraCount: number;
  congestionCount: number;
  roadworkCount: number;
  railCaseCount: number;
  objectCount: number;
};

type LayerCounts = Record<LayerKey, number>;

type DossierField = {
  label: string;
  value: string;
};

type SelectedDossier = {
  kind: "event" | "hotspot" | "rail_case" | "insight" | "empty";
  id: string;
  title: string;
  subtitle: string;
  severity: SmartCityEvent["severity"] | "none";
  confidence: number | null;
  coordinates: [number, number] | null;
  sourceUrl?: string;
  updatedAt?: string;
  recommendedAction?: string;
  fields: DossierField[];
};

type WorkspaceItem = {
  id: string;
  title: string;
  meta: string;
  severity?: string;
  coordinates?: [number, number] | null;
};

function opsFetch(path: string, init?: RequestInit) {
  const url = typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
  return fetch(url, init);
}

const severityRank = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function severityClass(value: string) {
  return `severity severity-${value}`;
}

function highestSeverity(events: SmartCityEvent[]) {
  return events.reduce<SmartCityEvent["severity"] | "none">((current, event) => {
    if (current === "none") return event.severity;
    return severityRank[event.severity] > severityRank[current] ? event.severity : current;
  }, "none");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "not connected";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function pointText(coordinates: [number, number] | null) {
  if (!coordinates) return "No verified geometry";
  return `${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}`;
}

function deriveTopStats(overview: OpsOverview | null, railOverview: RailOverview | null, ontology: OntologyReadModel | null): TopStats {
  const events = overview?.events ?? [];
  const weatherEvents = events.filter((event) => event.eventType === "weather_risk");
  const allSources = [...(overview?.sourceHealth ?? []), ...(railOverview?.sourceHealth ?? []), ...(ontology?.sourceHealth ?? [])];
  const activeSources = allSources.filter((source) => source.status === "ok" || source.status === "degraded").length;
  const weatherSeverity = highestSeverity(weatherEvents);
  return {
    liveIncidents: events.filter((event) => event.eventType === "incident" || event.eventType === "rail_crossing_incident").length,
    weatherRisk: weatherSeverity === "none" ? "No data" : weatherSeverity,
    weatherSeverity,
    activeSources,
    totalSources: allSources.length,
    hotspotCount: overview?.hotspots.length ?? 0,
    cameraCount: overview?.assets.filter((asset) => asset.assetType === "camera").length ?? 0,
    congestionCount: events.filter((event) => event.eventType === "congestion").length,
    roadworkCount: events.filter((event) => event.eventType === "roadwork").length,
    railCaseCount: railOverview?.cases.length ?? 0,
    objectCount: ontology?.objects.length ?? 0,
  };
}

function deriveLayerCounts(overview: OpsOverview | null, railOverview: RailOverview | null): LayerCounts {
  const events = overview?.events ?? [];
  return {
    incidents: events.filter((event) => event.eventType === "incident" || event.eventType === "rail_crossing_incident").length,
    hotspots: overview?.hotspots.length ?? 0,
    cameras:
      (overview?.assets.filter((asset) => asset.assetType === "camera").length ?? 0) +
      events.filter((event) => event.eventType === "camera_signal").length,
    congestion: events.filter((event) => event.eventType === "congestion").length,
    weather: events.filter((event) => event.eventType === "weather_risk").length,
    roadworks: events.filter((event) => event.eventType === "roadwork").length,
    osiris: events.filter((event) => event.sourceId.startsWith("osiris-")).length,
    rail: (railOverview?.crossings.length ?? 0) + (railOverview?.events.length ?? 0) + (railOverview?.cases.length ?? 0),
  };
}

function workspaceCount(key: WorkspaceKey, stats: TopStats, overview: OpsOverview | null, railOverview: RailOverview | null, ontology: OntologyReadModel | null) {
  if (key === "overview") return stats.objectCount + stats.liveIncidents + stats.hotspotCount;
  if (key === "incidents") return stats.liveIncidents;
  if (key === "hotspots") return stats.hotspotCount;
  if (key === "cameras") return stats.cameraCount;
  if (key === "weather") return overview?.events.filter((event) => event.eventType === "weather_risk").length ?? 0;
  if (key === "congestion") return stats.congestionCount;
  if (key === "roadworks") return stats.roadworkCount;
  if (key === "assets") return ontology?.objects.length ?? overview?.assets.length ?? 0;
  if (key === "reports") return (overview?.sourceHealth.length ?? 0) + (railOverview?.sourceHealth.length ?? 0);
  if (key === "analytics") return stats.activeSources;
  if (key === "alerts") return stats.liveIncidents + (stats.weatherSeverity === "none" ? 0 : 1);
  return 1;
}

function buildWorkspaceItems({
  key,
  overview,
  railOverview,
  ontology,
  insights,
  actionRecords,
}: {
  key: WorkspaceKey;
  overview: OpsOverview | null;
  railOverview: RailOverview | null;
  ontology: OntologyReadModel | null;
  insights: SmartCityInsight[];
  actionRecords: SmartCityActionRecord[];
}): WorkspaceItem[] {
  const events = overview?.events ?? [];
  if (key === "incidents") {
    return events
      .filter((event) => event.eventType === "incident" || event.eventType === "rail_crossing_incident")
      .slice(0, 12)
      .map((event) => ({
        id: event.id,
        title: event.title,
        meta: `${event.eventType.replaceAll("_", " ")} · ${formatTime(event.observedAt)}`,
        severity: event.severity,
        coordinates: event.geometry.coordinates,
      }));
  }
  if (key === "hotspots") {
    return (overview?.hotspots ?? []).slice(0, 12).map((hotspot) => ({
      id: hotspot.id,
      title: hotspot.name,
      meta: `${hotspot.corridor} · risk ${hotspot.riskScore}`,
      severity: hotspot.severity,
      coordinates: hotspot.geometry.coordinates,
    }));
  }
  if (key === "cameras") {
    return (overview?.assets ?? [])
      .filter((asset) => asset.assetType === "camera")
      .slice(0, 12)
      .map((asset) => ({
        id: asset.id,
        title: asset.name,
        meta: `${asset.region} · ${asset.sourceId}`,
        coordinates: asset.geometry.coordinates,
      }));
  }
  if (key === "weather") {
    return events
      .filter((event) => event.eventType === "weather_risk")
      .slice(0, 12)
      .map((event) => ({
        id: event.id,
        title: event.title,
        meta: `${event.region} · ${formatTime(event.observedAt)}`,
        severity: event.severity,
        coordinates: event.geometry.coordinates,
      }));
  }
  if (key === "congestion" || key === "roadworks") {
    const type = key === "congestion" ? "congestion" : "roadwork";
    return events
      .filter((event) => event.eventType === type)
      .slice(0, 12)
      .map((event) => ({
        id: event.id,
        title: event.title,
        meta: `${event.region} · confidence ${Math.round(event.confidence * 100)}%`,
        severity: event.severity,
        coordinates: event.geometry.coordinates,
      }));
  }
  if (key === "assets") {
    return (ontology?.objects ?? [])
      .slice(0, 12)
      .map((object) => ({
        id: object.id,
        title: object.displayName,
        meta: `${object.objectType.replaceAll("_", " ")} · ${object.sourceId}`,
        severity: object.severity,
        coordinates: object.geometry.coordinates,
      }));
  }
  if (key === "reports") {
    return [...(overview?.sourceHealth ?? []), ...(railOverview?.sourceHealth ?? [])].slice(0, 12).map((source) => ({
      id: source.sourceId,
      title: source.name,
      meta: `${source.provider} · ${source.status} · ${source.recordCount} rows`,
      severity: source.status,
    }));
  }
  if (key === "analytics") {
    return insights.slice(0, 12).map((insight) => ({
      id: insight.id,
      title: insight.title,
      meta: `risk ${insight.riskBefore} -> ${insight.expectedRiskAfter} · confidence ${Math.round(insight.confidence * 100)}%`,
      severity: insight.severity,
    }));
  }
  if (key === "alerts") {
    return [
      ...buildWorkspaceItems({ key: "incidents", overview, railOverview, ontology, insights, actionRecords }).slice(0, 8),
      ...buildWorkspaceItems({ key: "weather", overview, railOverview, ontology, insights, actionRecords }).slice(0, 4),
    ];
  }
  if (key === "settings") {
    return [
      { id: "mcp", title: "CivilMCP mode", meta: "Read-only evidence retrieval; no civil_* writes" },
      { id: "runtime", title: "Runtime", meta: "Real-data-only dashboard paths" },
      { id: "actions", title: "Action records", meta: `${actionRecords.length} persisted ops records` },
    ];
  }
  return [
    ...insights.slice(0, 4).map((insight) => ({
      id: insight.id,
      title: insight.title,
      meta: `actionable insight · ${Math.round(insight.confidence * 100)}% confidence`,
      severity: insight.severity,
    })),
    ...buildWorkspaceItems({ key: "incidents", overview, railOverview, ontology, insights, actionRecords }).slice(0, 4),
  ];
}

function buildCommandItems({
  overview,
  railOverview,
  ontology,
  insights,
}: {
  overview: OpsOverview | null;
  railOverview: RailOverview | null;
  ontology: OntologyReadModel | null;
  insights: SmartCityInsight[];
}): WorkspaceItem[] {
  return [
    ...(overview?.events ?? []).map((event) => ({
      id: event.id,
      title: event.title,
      meta: `event · ${event.eventType.replaceAll("_", " ")}`,
      severity: event.severity,
      coordinates: event.geometry.coordinates,
    })),
    ...(overview?.hotspots ?? []).map((hotspot) => ({
      id: hotspot.id,
      title: hotspot.name,
      meta: `hotspot · risk ${hotspot.riskScore}`,
      severity: hotspot.severity,
      coordinates: hotspot.geometry.coordinates,
    })),
    ...(overview?.assets ?? []).map((asset) => ({
      id: asset.id,
      title: asset.name,
      meta: `asset · ${asset.assetType.replaceAll("_", " ")}`,
      coordinates: asset.geometry.coordinates,
    })),
    ...(railOverview?.cases ?? []).map((railCase) => ({
      id: railCase.id,
      title: railCase.name,
      meta: `rail case · risk ${railCase.riskScore}`,
      severity: railCase.severity,
      coordinates: railCase.geometry.coordinates,
    })),
    ...(ontology?.sourceHealth ?? []).map((source) => ({
      id: source.sourceId,
      title: source.name,
      meta: `source · ${source.status} · ${source.recordCount} rows`,
      severity: source.status,
    })),
    ...insights.map((insight) => ({
      id: insight.id,
      title: insight.title,
      meta: `insight · ${insight.recommendedAction}`,
      severity: insight.severity,
    })),
  ];
}

function buildDossier({
  selectedEvent,
  selectedHotspot,
  selectedRailCase,
  selectedInsight,
  selectedInsightObject,
}: {
  selectedEvent: SmartCityEvent | null;
  selectedHotspot: SmartCityHotspot | null;
  selectedRailCase: RailSafetyCase | null;
  selectedInsight: SmartCityInsight | null;
  selectedInsightObject: SmartCityOntologyObject | null;
}): SelectedDossier {
  if (selectedEvent) {
    return {
      kind: "event",
      id: selectedEvent.id,
      title: selectedEvent.title,
      subtitle: selectedEvent.description,
      severity: selectedEvent.severity,
      confidence: selectedEvent.confidence,
      coordinates: selectedEvent.geometry.coordinates,
      sourceUrl: selectedEvent.sourceUrl,
      updatedAt: selectedEvent.observedAt,
      fields: [
        { label: "Type", value: selectedEvent.eventType.replaceAll("_", " ") },
        { label: "Status", value: selectedEvent.expiresAt ? "Active until expiry" : "Active" },
        { label: "Reported", value: formatDateTime(selectedEvent.observedAt) },
        { label: "Location", value: pointText(selectedEvent.geometry.coordinates) },
        { label: "Direction", value: String(selectedEvent.attributes.direction ?? selectedEvent.region) },
        { label: "Lanes affected", value: String(selectedEvent.attributes.lanesAffected ?? selectedEvent.attributes.lanes ?? "unknown") },
      ],
    };
  }

  if (selectedHotspot) {
    return {
      kind: "hotspot",
      id: selectedHotspot.id,
      title: selectedHotspot.name,
      subtitle: selectedHotspot.corridor,
      severity: selectedHotspot.severity,
      confidence: selectedHotspot.confidence,
      coordinates: selectedHotspot.geometry.coordinates,
      updatedAt: selectedHotspot.updatedAt,
      recommendedAction: selectedHotspot.recommendedAction,
      fields: [
        { label: "Type", value: "transport hotspot" },
        { label: "Status", value: selectedHotspot.trend },
        { label: "Risk score", value: String(selectedHotspot.riskScore) },
        { label: "Location", value: pointText(selectedHotspot.geometry.coordinates) },
        { label: "Corridor", value: selectedHotspot.corridor },
        { label: "Region", value: selectedHotspot.region },
      ],
    };
  }

  if (selectedRailCase) {
    return {
      kind: "rail_case",
      id: selectedRailCase.id,
      title: selectedRailCase.name,
      subtitle: selectedRailCase.corridor,
      severity: selectedRailCase.severity,
      confidence: selectedRailCase.confidence,
      coordinates: selectedRailCase.geometry.coordinates,
      updatedAt: selectedRailCase.updatedAt,
      recommendedAction: selectedRailCase.recommendedAction,
      fields: [
        { label: "Type", value: "SRT level-crossing case" },
        { label: "Crossing asset", value: selectedRailCase.crossingAssetId },
        { label: "Risk score", value: String(selectedRailCase.riskScore) },
        { label: "Location", value: pointText(selectedRailCase.geometry.coordinates) },
        { label: "Before risk", value: String(selectedRailCase.simulationSummary.beforeRisk) },
        { label: "After expected", value: String(selectedRailCase.simulationSummary.afterExpectedRisk) },
      ],
    };
  }

  if (selectedInsight) {
    return {
      kind: "insight",
      id: selectedInsight.id,
      title: selectedInsight.title,
      subtitle: selectedInsight.whyNow,
      severity: selectedInsight.severity,
      confidence: selectedInsight.confidence,
      coordinates: selectedInsightObject?.geometry.coordinates ?? null,
      sourceUrl: selectedInsightObject?.sourceUrl,
      updatedAt: selectedInsight.generatedAt,
      recommendedAction: selectedInsight.recommendedAction,
      fields: [
        { label: "Type", value: selectedInsight.objectType.replaceAll("_", " ") },
        { label: "Object ID", value: selectedInsight.objectId },
        { label: "Risk before", value: String(selectedInsight.riskBefore) },
        { label: "After expected", value: String(selectedInsight.expectedRiskAfter) },
        { label: "Delta", value: String(selectedInsight.delta) },
        { label: "Evidence", value: `${selectedInsight.evidence.length} item(s)` },
        { label: "Executable", value: selectedInsight.requiresResearch ? "Research required" : "Ready for gate" },
      ],
    };
  }

  return {
    kind: "empty",
    id: "empty",
    title: "No selected real object",
    subtitle: "Connect real transport sources or select a live object from the map.",
    severity: "none",
    confidence: null,
    coordinates: null,
    fields: [],
  };
}

function statusIcon(status: SourceHealth["status"]) {
  if (status === "ok") return <CheckCircle2 size={14} />;
  if (status === "offline") return <WifiOff size={14} />;
  return <Activity size={14} />;
}

function dataClassLabel(source: SourceHealth) {
  if (source.dataClass === "near_real_time") return "Near real-time";
  if (source.dataClass === "official_baseline") return "Official baseline";
  if (source.dataClass === "historical") return "Historical";
  if (source.dataClass === "needs_config") return "Needs config";
  if (source.dataClass === "stale") return "Stale";
  if (source.status === "needs_config") return "Needs config";
  if (source.status === "stale") return "Stale";
  return "Live";
}

function compactDataClassLabel(source: SourceHealth) {
  const label = dataClassLabel(source);
  if (label === "Near real-time") return "NRT";
  if (label === "Official baseline") return "Official";
  if (label === "Needs config") return "Config";
  if (label === "Historical") return "History";
  return label;
}

function compactTruthClassLabel(label: string) {
  if (label === "Near real-time") return "NRT";
  if (label === "Official baseline") return "Official";
  if (label === "Needs config") return "Config";
  if (label === "Historical") return "History";
  return label;
}

function compactLayerLabel(key: LayerKey) {
  return COMPACT_LAYER_LABELS[key];
}

function isDashboardLayerKey(value: string): value is LayerKey {
  return value in DEFAULT_LAYERS;
}

function layerRegistryMeta(registry: OpsLayerRegistryResponse | null, key: LayerKey) {
  return registry?.layers.find((layer) => layer.id === key) ?? null;
}

function compactFreshness(seconds: number | null | undefined) {
  if (seconds == null) return "no fetch";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function compactSourceName(value: string) {
  return value
    .replace(/^Bangkok traffic and transport references$/i, "BMA traffic")
    .replace(/^Bangkok Metropolitan Administration$/i, "BMA")
    .replace(/^Open Government traffic datasets$/i, "Open data")
    .replace(/^Open Government Data of Thailand$/i, "data.go.th")
    .replace(/^iTIC \/ Longdo live traffic events$/i, "iTIC live")
    .replace(/^iTIC historical traffic and incident data$/i, "iTIC history")
    .replace(/^iTIC Foundation \/ Longdo Traffic$/i, "iTIC")
    .replace(/^OSIRIS /i, "");
}

function shortResourceId(value: string) {
  const cleaned = value.replace(/^#/, "");
  const parts = cleaned.split(/[/:.]/).filter(Boolean);
  const last = parts.at(-1) ?? cleaned;
  if (last.length <= 18) return last;
  return `${last.slice(0, 7)}...${last.slice(-6)}`;
}

function compactDossierLabel(label: string) {
  const labels: Record<string, string> = {
    "After expected": "After",
    "Before risk": "Before",
    "Crossing asset": "Asset",
    "Lanes affected": "Lanes",
    "Last update": "Updated",
    "Object ID": "Object",
    "Risk before": "Before",
    "Risk score": "Risk",
  };
  return labels[label] ?? label;
}

function compactWorkspaceMeta(value: string) {
  return value
    .replaceAll("confidence", "conf")
    .replaceAll("actionable insight", "insight")
    .replaceAll("transport hotspot", "hotspot")
    .replaceAll("rail crossing incident", "rail incident")
    .replaceAll("weather risk", "weather")
    .replaceAll("camera signal", "camera")
    .replaceAll("near_real_time", "NRT")
    .replaceAll("official_baseline", "official")
    .replaceAll("needs_config", "config")
    .replace(/ · /g, "  ");
}

function compactToolLabel(key: ToolKey) {
  const labels: Record<ToolKey, string> = {
    search: "Search",
    measure: "Measure",
    draw: "Draw",
    bookmarks: "Marks",
    layers: "Layers",
  };
  return labels[key];
}

function compactDrawerLabel(value: string) {
  const labels: Record<string, string> = {
    Region: "Region",
    "Live alerts": "Alerts",
    "Operations help": "Help",
    Session: "Session",
  };
  return labels[value] ?? value;
}

function shortRecordTitle(value: string) {
  if (value.length <= 54) return value;
  return `${value.slice(0, 42).trim()}...${value.slice(-8)}`;
}

function compactSectionTitle(value: string) {
  const labels: Record<string, string> = {
    "Questions to ask CivilMCP": "Questions",
    "Research findings": "Evidence",
    "Evidence split": "Evidence",
    "Recommended actions": "Actions",
    "Recommended action simulations": "Delta",
    "Live/news signal": "Signals",
    "Action sequence": "Sequence",
    "Citation to action map": "Citation map",
  };
  return labels[value] ?? value;
}

function truthClassCounts(sources: SourceHealth[]) {
  return sources.reduce<Record<string, number>>((acc, source) => {
    const dataClass = dataClassLabel(source);
    acc[dataClass] = (acc[dataClass] ?? 0) + 1;
    return acc;
  }, {});
}

function formatTime(value: string | null) {
  if (!value) return "not connected";
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function eventCollection(events: SmartCityEvent[], layers: LayerState): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events
      .filter((event) => {
        if (event.sourceId.startsWith("osiris-") && event.eventType !== "weather_risk" && event.eventType !== "camera_signal") {
          return layers.osiris;
        }
        if (event.eventType === "weather_risk") return layers.weather;
        if (event.eventType === "camera_signal") return layers.cameras;
        if (event.eventType === "congestion") return layers.congestion;
        if (event.eventType === "roadwork") return layers.roadworks;
        return layers.incidents;
      })
      .map((event) => ({
        type: "Feature",
        geometry: event.geometry,
        properties: {
          id: event.id,
          title: event.title,
          severity: event.severity,
          eventType: event.eventType,
          confidence: event.confidence,
        },
      })),
  };
}

function hotspotCollection(hotspots: SmartCityHotspot[], enabled: boolean): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: enabled
      ? hotspots.map((hotspot) => ({
          type: "Feature",
          geometry: hotspot.geometry,
          properties: {
            id: hotspot.id,
            name: hotspot.name,
            riskScore: hotspot.riskScore,
            severity: hotspot.severity,
            trend: hotspot.trend,
          },
        }))
      : [],
  };
}

function assetCollection(overview: OpsOverview | null, layers: LayerState): FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      overview
        ? overview.assets
            .filter((asset) => {
              if (asset.assetType === "camera") return layers.cameras;
              if (asset.assetType === "weather_station" || asset.assetType === "air_quality_station") return layers.weather;
              return layers.osiris;
            })
            .map((asset) => ({
              type: "Feature",
              geometry: asset.geometry,
              properties: {
                id: asset.id,
                name: asset.name,
                assetType: asset.assetType,
              },
            }))
        : [],
  };
}

function railEventCollection(railOverview: RailOverview | null, enabled: boolean): FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      railOverview && enabled
        ? railOverview.events.map((event) => ({
            type: "Feature",
            geometry: event.geometry,
            properties: {
              id: event.id,
              title: event.title,
              severity: event.severity,
              eventType: event.eventType,
              confidence: event.confidence,
            },
          }))
        : [],
  };
}

function railCrossingCollection(railOverview: RailOverview | null, enabled: boolean): FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      railOverview && enabled
        ? railOverview.crossings.map((asset) => ({
            type: "Feature",
            geometry: asset.geometry,
            properties: {
              id: asset.id,
              name: asset.name,
              assetType: asset.assetType,
            },
          }))
        : [],
  };
}

function railCaseCollection(railOverview: RailOverview | null, enabled: boolean): FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      railOverview && enabled
        ? railOverview.cases.map((railCase) => ({
            type: "Feature",
            geometry: railCase.geometry,
            properties: {
              id: railCase.id,
              name: railCase.name,
              riskScore: railCase.riskScore,
              severity: railCase.severity,
            },
          }))
        : [],
  };
}

function bindMapData(map: MapLibreMap, overview: OpsOverview, layers: LayerState) {
  const events = map.getSource("ops-events") as GeoJSONSource | undefined;
  const hotspots = map.getSource("ops-hotspots") as GeoJSONSource | undefined;
  const assets = map.getSource("ops-assets") as GeoJSONSource | undefined;
  events?.setData(eventCollection(overview.events, layers));
  hotspots?.setData(hotspotCollection(overview.hotspots, layers.hotspots));
  assets?.setData(assetCollection(overview, layers));
}

function bindRailData(map: MapLibreMap, railOverview: RailOverview | null, layers: LayerState) {
  const railEvents = map.getSource("rail-events") as GeoJSONSource | undefined;
  const railCrossings = map.getSource("rail-crossings") as GeoJSONSource | undefined;
  const railCases = map.getSource("rail-cases") as GeoJSONSource | undefined;
  railEvents?.setData(railEventCollection(railOverview, layers.rail));
  railCrossings?.setData(railCrossingCollection(railOverview, layers.rail));
  railCases?.setData(railCaseCollection(railOverview, layers.rail));
}

function initializeMap(
  container: HTMLDivElement,
  overview: OpsOverview,
  onSelectHotspot: (id: string) => void,
  onSelectEvent: (id: string) => void,
  onSelectRailCase: (id: string) => void,
) {
  const map = new maplibregl.Map({
    container,
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    center: overview.viewport.center,
    zoom: overview.viewport.zoom,
    minZoom: 8,
    maxZoom: 17,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");

  map.on("load", () => {
    map.addSource("ops-events", { type: "geojson", data: eventCollection(overview.events, DEFAULT_LAYERS) });
    map.addSource("ops-hotspots", { type: "geojson", data: hotspotCollection(overview.hotspots, true) });
    map.addSource("ops-assets", { type: "geojson", data: assetCollection(overview, DEFAULT_LAYERS) });
    map.addSource("rail-events", { type: "geojson", data: railEventCollection(null, true) });
    map.addSource("rail-crossings", { type: "geojson", data: railCrossingCollection(null, true) });
    map.addSource("rail-cases", { type: "geojson", data: railCaseCollection(null, true) });

    map.addLayer({
      id: "ops-weather-risk",
      type: "circle",
      source: "ops-events",
      filter: ["==", ["get", "eventType"], "weather_risk"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 14, 40],
        "circle-color": "#25a4ff",
        "circle-opacity": 0.14,
        "circle-blur": 0.8,
      },
    });

    map.addLayer({
      id: "ops-event-points",
      type: "circle",
      source: "ops-events",
      filter: ["!=", ["get", "eventType"], "weather_risk"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 14, 12],
        "circle-color": [
          "match",
          ["get", "severity"],
          "critical",
          "#ff3b4f",
          "high",
          "#ff8a3d",
          "medium",
          "#f8c43a",
          "#35d07f",
        ],
        "circle-opacity": 0.82,
        "circle-stroke-color": "#0b1118",
        "circle-stroke-width": 1.4,
      },
    });

    map.addLayer({
      id: "ops-hotspot-halo",
      type: "circle",
      source: "ops-hotspots",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "riskScore"], 50, 18, 90, 42],
        "circle-color": [
          "match",
          ["get", "severity"],
          "critical",
          "#ff3b4f",
          "high",
          "#ff8a3d",
          "medium",
          "#f8c43a",
          "#35d07f",
        ],
        "circle-opacity": 0.16,
        "circle-blur": 0.8,
      },
    });

    map.addLayer({
      id: "ops-hotspot-hit",
      type: "circle",
      source: "ops-hotspots",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 7, 14, 14],
        "circle-color": "#f7f8fb",
        "circle-opacity": 0.92,
        "circle-stroke-color": "#ff8a3d",
        "circle-stroke-width": 2,
      },
    });

    map.addLayer({
      id: "ops-hotspot-label",
      type: "symbol",
      source: "ops-hotspots",
      minzoom: 10,
      layout: {
        "text-field": ["concat", ["get", "riskScore"], "  ", ["get", "name"]],
        "text-size": 11,
        "text-offset": [0, 1.55],
        "text-font": ["Open Sans Semibold"],
      },
      paint: {
        "text-color": "#f7f8fb",
        "text-halo-color": "#0b1118",
        "text-halo-width": 1.2,
      },
    });

    map.addLayer({
      id: "ops-assets",
      type: "symbol",
      source: "ops-assets",
      layout: {
        "text-field": [
          "match",
          ["get", "assetType"],
          "camera",
          "CCTV",
          "weather_station",
          "WX",
          "air_quality_station",
          "AQ",
          "aircraft",
          "AIR",
          "vessel",
          "SHIP",
          "port",
          "PORT",
          "chokepoint",
          "CHOKE",
          "satellite",
          "SAT",
          "infrastructure",
          "INF",
          "news_feed",
          "NEWS",
          "NODE",
        ],
        "text-size": 10,
        "text-font": ["Open Sans Bold"],
        "text-offset": [0, 0],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": [
          "match",
          ["get", "assetType"],
          "camera",
          "#67e8f9",
          "weather_station",
          "#38bdf8",
          "air_quality_station",
          "#35d07f",
          "aircraft",
          "#f8c43a",
          "vessel",
          "#38bdf8",
          "port",
          "#67e8f9",
          "chokepoint",
          "#ff8a3d",
          "satellite",
          "#f7f8fb",
          "infrastructure",
          "#ff3b4f",
          "news_feed",
          "#35d07f",
          "#f7f8fb",
        ],
        "text-halo-color": "#071018",
        "text-halo-width": 1.5,
      },
    });

    map.addLayer({
      id: "rail-case-halo",
      type: "circle",
      source: "rail-cases",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "riskScore"], 50, 16, 90, 38],
        "circle-color": "#ff3b4f",
        "circle-opacity": 0.14,
        "circle-blur": 0.75,
      },
    });

    map.addLayer({
      id: "rail-case-hit",
      type: "circle",
      source: "rail-cases",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 7, 14, 13],
        "circle-color": "#ff3b4f",
        "circle-opacity": 0.9,
        "circle-stroke-color": "#f7f8fb",
        "circle-stroke-width": 1.4,
      },
    });

    map.addLayer({
      id: "rail-crossing-label",
      type: "symbol",
      source: "rail-crossings",
      minzoom: 10,
      layout: {
        "text-field": "RAIL",
        "text-size": 10,
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ff3b4f",
        "text-halo-color": "#071018",
        "text-halo-width": 1.5,
      },
    });

    map.addLayer({
      id: "rail-event-points",
      type: "circle",
      source: "rail-events",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 11],
        "circle-color": [
          "match",
          ["get", "eventType"],
          "rail_crossing_incident",
          "#ff3b4f",
          "rail_crossing_risk",
          "#ff8a3d",
          "rail_weather_disruption",
          "#38bdf8",
          "#f8c43a",
        ],
        "circle-opacity": 0.86,
        "circle-stroke-color": "#071018",
        "circle-stroke-width": 1.2,
      },
    });

    map.on("click", "ops-hotspot-hit", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) onSelectHotspot(String(id));
    });

    map.on("click", "ops-event-points", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) onSelectEvent(String(id));
    });

    map.on("click", "rail-case-hit", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) onSelectRailCase(String(id));
    });

    ["ops-hotspot-hit", "ops-event-points", "rail-case-hit"].forEach((layer) => {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  });

  return map;
}

function TopBar({
  stats,
  onRefresh,
  loading,
  navCollapsed,
  openPopover,
  onToggleNav,
  onTogglePopover,
}: {
  stats: TopStats;
  onRefresh: () => void;
  loading: boolean;
  navCollapsed: boolean;
  openPopover: PopoverKey;
  onToggleNav: () => void;
  onTogglePopover: (key: Exclude<PopoverKey, null>) => void;
}) {
  const [clock, setClock] = useState<{ time: string; date: string } | null>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock({
        time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(now),
        date: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }).format(now),
      });
    };
    updateClock();
    const id = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="topBar">
      <div className="commandIdentity">
        <button className={`chromeIconButton ${navCollapsed ? "active" : ""}`} type="button" onClick={onToggleNav} aria-label="Main menu">
          <Menu size={22} />
        </button>
        <div className="brandIcon">
          <Route size={28} />
        </div>
        <div className="brandCluster">
          <h1>Thailand Transport Safety Ops</h1>
        </div>
        <button
          className={`regionSelect ${openPopover === "region" ? "active" : ""}`}
          type="button"
          onClick={() => onTogglePopover("region")}
          aria-label="Region: Bangkok pilot"
          title="Bangkok pilot"
        >
          <span className="regionFull">Bangkok pilot</span>
          <span className="regionShort" aria-hidden="true">BKK</span>
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="topControls">
        <div className="commandMetric danger" aria-label={`Live incidents: ${stats.liveIncidents}`} title={`Live incidents: ${stats.liveIncidents}`}>
          <TriangleAlert size={24} />
          <span>Live incidents</span>
          <strong>{stats.liveIncidents}</strong>
        </div>
        <div className={`commandMetric weather weather-${stats.weatherSeverity}`} aria-label={`Weather risk: ${stats.weatherRisk}`} title={`Weather risk: ${stats.weatherRisk}`}>
          <CloudRain size={24} />
          <span>Weather risk</span>
          <strong>{stats.weatherRisk}</strong>
        </div>
        <div className="commandMetric sourceMetric" aria-label={`Sources: ${stats.activeSources} of ${stats.totalSources}`} title={`Sources: ${stats.activeSources}/${stats.totalSources}`}>
          <Radio size={20} />
          <span>Sources</span>
          <strong>
            {stats.activeSources}/{stats.totalSources}
          </strong>
        </div>
        <div className="clockBlock" aria-label={`ICT time: ${clock?.time ?? "--:--"}, ${clock?.date ?? "ICT"}`} title={`${clock?.date ?? "ICT"} · ICT`}>
          <strong>{clock?.time ?? "--:--"}</strong>
          <span>{clock?.date ?? "ICT"} · ICT</span>
        </div>
        <button className="chromeIconButton" type="button" onClick={onRefresh} aria-label="Refresh dashboard">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
        <button
          className={`chromeIconButton notificationButton ${openPopover === "alerts" ? "active" : ""}`}
          type="button"
          onClick={() => onTogglePopover("alerts")}
          aria-label="Notifications"
        >
          <Bell size={20} />
          <span>{stats.liveIncidents}</span>
        </button>
        <button className={`chromeIconButton ${openPopover === "help" ? "active" : ""}`} type="button" onClick={() => onTogglePopover("help")} aria-label="Help">
          <HelpCircle size={20} />
        </button>
        <button className={`chromeIconButton ${openPopover === "user" ? "active" : ""}`} type="button" onClick={() => onTogglePopover("user")} aria-label="User">
          <UserCircle size={20} />
        </button>
      </div>
    </header>
  );
}

function LayerRail({
  layers,
  counts,
  registry,
  collapsed,
  setLayers,
  onToggleCollapsed,
}: {
  layers: LayerState;
  counts: LayerCounts;
  registry: OpsLayerRegistryResponse | null;
  collapsed: boolean;
  setLayers: (layers: LayerState) => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside className={`layerRail ${collapsed ? "collapsed" : ""}`} aria-label="Map layers">
      <button className="railTitle" type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
        <Layers size={15} />
        <span>Map layers</span>
        <strong>{Object.values(counts).reduce((sum, count) => sum + count, 0)}</strong>
        <ChevronDown size={13} />
      </button>
      {!collapsed
        ? (Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => {
            const Icon = LAYER_LABELS[key].icon;
            const meta = layerRegistryMeta(registry, key);
            const count = meta?.count ?? counts[key];
            const truth = meta?.dataClass ? meta.dataClass.replaceAll("_", " ") : "needs config";
            const title = meta
              ? `${meta.label}: ${meta.count} object(s) · ${truth} · ${meta.status} · freshness ${compactFreshness(meta.freshnessSeconds)} · ${meta.provenance.join(" · ")}`
              : `${LAYER_LABELS[key].label}: ${counts[key]} object(s)`;
            return (
              <button
                key={key}
                type="button"
                className={`layerButton ${layers[key] ? "active" : ""}`}
                onClick={() => setLayers({ ...layers, [key]: !layers[key] })}
                aria-label={title}
                title={title}
              >
                <span className="layerCheckbox" aria-hidden="true">
                  {layers[key] ? "✓" : ""}
                </span>
                <Icon size={16} />
                <span>{compactLayerLabel(key)}</span>
                <small className={`layerMeta source-${meta?.status ?? "needs_config"}`}>{meta?.dataClass === "near_real_time" ? "NRT" : meta?.dataClass === "official_baseline" ? "Official" : meta?.dataClass === "needs_config" ? "Config" : meta?.dataClass ?? "Real"}</small>
                <strong>{count}</strong>
              </button>
            );
          })
        : null}
    </aside>
  );
}

function NavRail({
  stats,
  overview,
  railOverview,
  ontology,
  activeWorkspace,
  activeTool,
  collapsed,
  onSelectWorkspace,
  onSelectTool,
}: {
  stats: TopStats;
  overview: OpsOverview | null;
  railOverview: RailOverview | null;
  ontology: OntologyReadModel | null;
  activeWorkspace: WorkspaceKey;
  activeTool: ToolKey | null;
  collapsed: boolean;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  onSelectTool: (key: ToolKey) => void;
}) {
  const navItems = Object.entries(WORKSPACE_META) as Array<[WorkspaceKey, (typeof WORKSPACE_META)[WorkspaceKey]]>;
  const tools = Object.entries(TOOL_META) as Array<[ToolKey, (typeof TOOL_META)[ToolKey]]>;

  return (
    <nav className={`opsNav ${collapsed ? "collapsed" : ""}`} aria-label="Operations navigation">
      <div className="navItems">
        {navItems.map(([key, item]) => {
          const Icon = item.icon;
          const count = workspaceCount(key, stats, overview, railOverview, ontology);
          return (
            <button
              key={key}
              type="button"
              className={`navItem ${activeWorkspace === key ? "active" : ""}`}
              onClick={() => onSelectWorkspace(key)}
              aria-pressed={activeWorkspace === key}
              aria-label={`${item.label}: ${count}`}
              title={`${item.label}: ${count}`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              <strong className={key === "incidents" ? "navBadge" : ""}>{count}</strong>
            </button>
          );
        })}
      </div>
      <div className="navFoot">
        <small>Map tools</small>
        {tools.map(([key, item]) => {
          const Icon = item.icon;
          return (
            <button
              key={key}
              className={`navItem toolItem ${activeTool === key ? "active" : ""}`}
              type="button"
              onClick={() => onSelectTool(key)}
              aria-pressed={activeTool === key}
              aria-label={`${item.label} tool`}
              title={`${item.label} tool`}
            >
              <Icon size={16} />
              <span>{compactToolLabel(key)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SourceHealthStrip({
  sources,
}: {
  sources: SourceHealth[];
}) {
  const okCount = sources.filter((source) => source.status === "ok" || source.status === "degraded").length;
  const visibleSources = sources.slice(0, 6);
  const hiddenCount = Math.max(0, sources.length - visibleSources.length);
  const classCounts = truthClassCounts(sources);
  return (
    <section className="sourceStrip" aria-label="Source health">
      <div className="stripHeader">
        <span>Source health</span>
        <span>{sources.length === 0 ? "No connected real source" : `${okCount}/${sources.length} connected`}</span>
      </div>
      {sources.length > 0 ? (
        <div className="truthClassBar" aria-label="Data truth labels">
          {Object.entries(classCounts).map(([dataClass, count]) => (
            <span key={dataClass} title={`${dataClass}: ${count}`} aria-label={`${dataClass}: ${count}`}>
              {compactTruthClassLabel(dataClass)} <b>{count}</b>
            </span>
          ))}
        </div>
      ) : null}
      <div className="sourceRows">
        {sources.length === 0 ? <div className="emptyBrief compactEmpty">No connected real source</div> : null}
        {visibleSources.map((source) => (
          <div
            key={source.sourceId}
            className="sourceRow"
            title={`${source.name} · ${source.provider} · ${dataClassLabel(source)} · ${source.recordCount} rows · ${formatTime(source.lastSuccessAt)}`}
          >
            <span className={`sourceStatus source-${source.status}`}>{statusIcon(source.status)}</span>
            <span className="sourceName">{compactSourceName(source.name)}</span>
            <span className="sourceTruth" title={dataClassLabel(source)} aria-label={dataClassLabel(source)}>
              {compactDataClassLabel(source)}
            </span>
            <span className="sourceProvider">{compactSourceName(source.provider)}</span>
            <span className="sourceMeta">{formatTime(source.lastSuccessAt)}</span>
            <span className="sourceCount" aria-label={`${source.recordCount} rows`}>{source.recordCount}</span>
          </div>
        ))}
        {hiddenCount > 0 ? <div className="sourceMore" title={`${hiddenCount} more Osiris/source connectors in overview payload`}>+{hiddenCount} sources</div> : null}
      </div>
    </section>
  );
}

function Timeline({ overview }: { overview: OpsOverview | null }) {
  const max = Math.max(1, ...(overview?.timeline ?? []).map((bucket) => bucket.incidents + bucket.congestion + bucket.weather));
  const hasTimeline = (overview?.timeline.length ?? 0) > 0;
  return (
    <section className="timelinePanel" aria-label="Signal timeline">
      <div className="stripHeader">
        <span>24h signals</span>
        <span className="timelineLegend" aria-label="Incident, congestion, weather">
          <i className="incidentDot" /> <i className="congestionDot" /> <i className="weatherDot" />
        </span>
      </div>
      <div className="timelineBars">
        {!hasTimeline ? <div className="emptyBrief compactEmpty">No real timeline buckets available</div> : null}
        {(overview?.timeline ?? []).map((bucket) => {
          const total = bucket.incidents + bucket.congestion + bucket.weather;
          return (
            <div className="timelineBucket" key={bucket.label}>
              <div className="timelineTrack">
                <span className="incidentBar" style={{ height: `${(bucket.incidents / max) * 100}%` }} />
                <span className="congestionBar" style={{ height: `${(bucket.congestion / max) * 100}%` }} />
                <span className="weatherBar" style={{ height: `${(bucket.weather / max) * 100}%` }} />
              </div>
              <span>{bucket.label}</span>
              <strong>{total}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HotspotList({
  hotspots,
  selectedId,
  onSelect,
}: {
  hotspots: SmartCityHotspot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="hotspotList" aria-label="Transport safety hotspots">
      <div className="sectionTitle">
        <TrendingUp size={15} />
        <span>Transport safety hotspots</span>
      </div>
      {hotspots.length === 0 ? (
        <div className="emptyBrief">No real hotspot is available yet. Connect live traffic, incident, or Osiris sources to render points.</div>
      ) : null}
      {[...hotspots]
        .sort((a, b) => b.riskScore - a.riskScore)
        .map((hotspot) => (
          <button
            type="button"
            key={hotspot.id}
            className={`hotspotRow ${selectedId === hotspot.id ? "selected" : ""}`}
            onClick={() => onSelect(hotspot.id)}
          >
            <span className="riskScore">{hotspot.riskScore}</span>
            <span className="hotspotText">
              <strong>{hotspot.name}</strong>
              <span>{hotspot.corridor}</span>
            </span>
            <span className={severityClass(hotspot.severity)}>{hotspot.severity}</span>
          </button>
        ))}
    </section>
  );
}

function AnalystPanel({
  brief,
  loading,
  onAnalyze,
  onOpenResearch,
}: {
  brief: AnalystBrief | null;
  loading: boolean;
  onAnalyze: () => void;
  onOpenResearch: () => void;
}) {
  return (
    <section className="analystPanel">
      <div className="sectionTitle">
        <Bot size={15} />
        <span>CivilMCP Analyst</span>
      </div>
      <p className="panelSubcopy">Research-backed guidance · Read-only MCP</p>
      <div className="analystActions">
        <button className="primaryButton" type="button" onClick={onOpenResearch}>
          <SearchCheck size={15} />
          Research gate
        </button>
        <button className="secondaryButton" type="button" onClick={onAnalyze} disabled={loading}>
          {loading ? "Analyzing..." : "Quick analyze"}
        </button>
      </div>
      {brief ? (
        <div className="briefBlock">
          <strong>{brief.summary}</strong>
          <ul>
            {brief.guidance.slice(0, 3).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="evidenceBox">
            <span>Evidence</span>
            {brief.evidence.length > 0 ? (
              brief.evidence.slice(0, 3).map((item) => (
                <p key={item.id}>
                  <FileText size={13} /> {item.citation}
                </p>
              ))
            ) : (
              <p>Offline fallback active. MCP evidence unavailable.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="emptyBrief">Select a hotspot and run analysis to combine live context with CivilMCP transport evidence.</div>
      )}
    </section>
  );
}

function DossierPanel({
  selectedHotspot,
  relatedEvents,
  onOpenAnalyst,
}: {
  selectedHotspot: SmartCityHotspot | null;
  relatedEvents: SmartCityEvent[];
  onOpenAnalyst: () => void;
}) {
  if (!selectedHotspot) {
    return (
      <aside className="dossierPanel">
        <div className="emptyState">
          <MapPinned size={28} />
          <h2>Select a hotspot</h2>
          <p>Click a map marker or hotspot row to open the operational dossier.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="dossierPanel">
      <div className="dossierHeader">
        <div>
          <span className="miniLabel">{selectedHotspot.region}</span>
          <h2>{selectedHotspot.name}</h2>
          <p>{selectedHotspot.corridor}</p>
        </div>
        <div className="dossierActions">
          <span className={severityClass(selectedHotspot.severity)}>{selectedHotspot.severity}</span>
          <button className="miniAnalystButton" type="button" onClick={onOpenAnalyst}>
            <Bot size={14} />
            CivilMCP
          </button>
        </div>
      </div>

      <div className="riskGrid">
        <div>
          <span>Risk score</span>
          <strong>{selectedHotspot.riskScore}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{Math.round(selectedHotspot.confidence * 100)}%</strong>
        </div>
        <div>
          <span>Trend</span>
          <strong>{selectedHotspot.trend}</strong>
        </div>
      </div>

      <section className="evidenceList">
        <div className="sectionTitle">
          <ShieldAlert size={15} />
          <span>Evidence split</span>
        </div>
        {selectedHotspot.evidence.map((item) => (
          <div key={`${item.kind}-${item.label}`} className="evidenceRow">
            <span>{item.kind}</span>
            <strong>{item.label}</strong>
            <p>{item.value}</p>
          </div>
        ))}
      </section>

      <section className="eventStack">
        <div className="sectionTitle">
          <TrafficCone size={15} />
          <span>Related live signals</span>
        </div>
        {relatedEvents.length > 0 ? (
          relatedEvents.map((event) => (
            <div className="eventRow" key={event.id}>
              <span className={severityClass(event.severity)}>{event.severity}</span>
              <strong>{event.title}</strong>
              <p>{event.description}</p>
            </div>
          ))
        ) : (
          <div className="emptyBrief">No directly related live signal is selected.</div>
        )}
      </section>

    </aside>
  );
}

function InsightDock({
  hotspot,
  relatedEvents,
  sourceHealth,
  brief,
  onOpenAnalyst,
  onOpenResearch,
}: {
  hotspot: SmartCityHotspot | null;
  relatedEvents: SmartCityEvent[];
  sourceHealth: SourceHealth[];
  brief: AnalystBrief | null;
  onOpenAnalyst: () => void;
  onOpenResearch: () => void;
}) {
  if (!hotspot) return null;
  const primarySignal = relatedEvents[0];
  const osirisLive = sourceHealth.filter((source) => source.sourceId.startsWith("osiris-") && source.status === "ok").length;
  const mcpState =
    brief?.mode === "mcp_read_only"
      ? `${brief.evidence.length} MCP citation${brief.evidence.length === 1 ? "" : "s"}`
      : brief?.mode === "offline_fallback"
        ? "MCP fallback"
        : "MCP not run";

  return (
    <aside className="insightDock" aria-label="Actionable insight">
      <div className="sectionTitle">
        <SearchCheck size={15} />
        <span>Actionable insight</span>
      </div>
      <div className="insightHeadline">
        <span className={severityClass(hotspot.severity)}>{hotspot.severity}</span>
        <strong>{hotspot.name}</strong>
      </div>
      <p>{hotspot.recommendedAction}</p>
      <div className="insightFacts">
        <span>Risk {hotspot.riskScore}</span>
        <span>Confidence {Math.round(hotspot.confidence * 100)}%</span>
        <span>{primarySignal ? primarySignal.eventType.replace("_", " ") : "no live match"}</span>
      </div>
      <div className="provenancePills">
        <span>Osiris {osirisLive > 0 ? `${osirisLive} live feeds` : "not connected"}</span>
        <span>{mcpState}</span>
      </div>
      {brief?.mode === "mcp_read_only" && brief.guidance[0] ? <p className="mcpGuidance">MCP: {brief.guidance[0]}</p> : null}
      <div className="insightActions">
        <button className="primaryButton" type="button" onClick={onOpenResearch}>
          <SearchCheck size={15} />
          Ask CivilMCP research
        </button>
        <button className="iconTextButton" type="button" onClick={onOpenAnalyst}>
          <Bot size={15} />
          Analyst popup
        </button>
      </div>
    </aside>
  );
}

function RailSafetyPanel({
  railOverview,
  selectedCase,
  relatedEvents,
  workflow,
  records,
  onSelectCase,
  onOpenResearch,
}: {
  railOverview: RailOverview | null;
  selectedCase: RailSafetyCase | null;
  relatedEvents: SmartCityEvent[];
  workflow: RailResearchWorkflowResponse | null;
  records: RailActionRecord[];
  onSelectCase: (id: string) => void;
  onOpenResearch: () => void;
}) {
  if (!railOverview || !selectedCase) {
    return (
      <section className="railPanel">
        <div className="sectionTitle">
          <TrainFront size={15} />
          <span>SRT level crossings</span>
        </div>
        <div className="emptyBrief">
          {railOverview
            ? "Rail source check: official DRT baseline may be missing, live rail feed may be unconfigured, or Osiris rail context may be stale. No rail case is shown unless real crossing geometry and historical/live evidence are linked."
            : "Loading rail crossing intelligence from configured real sources..."}
        </div>
      </section>
    );
  }

  const simulation = workflow?.proposals[0]?.simulation ?? selectedCase.simulationSummary;
  const mcpEvidenceCount = workflow?.findings.reduce((sum, finding) => sum + finding.evidence.length, 0) ?? 0;
  const localRecords = records.filter((record) => record.caseId === selectedCase.id);

  return (
    <section className="railPanel" aria-label="SRT level crossing safety">
      <div className="sectionTitle">
        <TrainFront size={15} />
        <span>SRT level crossings</span>
      </div>
      <div className="railCasePicker">
        {railOverview.cases.map((railCase) => (
          <button
            key={railCase.id}
            type="button"
            className={`railCaseButton ${railCase.id === selectedCase.id ? "selected" : ""}`}
            onClick={() => onSelectCase(railCase.id)}
          >
            <strong>{railCase.riskScore}</strong>
            <span>{railCase.name}</span>
          </button>
        ))}
      </div>
      <div className="railFocus">
        <div className="railFocusHead">
          <div>
            <span className="miniLabel">Rail safety case</span>
            <h3>{selectedCase.name}</h3>
            <p>{selectedCase.recommendedAction}</p>
          </div>
          <span className={severityClass(selectedCase.severity)}>{selectedCase.severity}</span>
        </div>
        <div className="simulationGrid">
          <div>
            <span>Before risk</span>
            <strong>{simulation.beforeRisk}</strong>
          </div>
          <div>
            <span>After expected</span>
            <strong>{simulation.afterExpectedRisk}</strong>
          </div>
          <div>
            <span>Delta</span>
            <strong>{simulation.delta}</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{Math.round(simulation.confidence * 100)}%</strong>
          </div>
        </div>
        <div className="railEvidenceSplit">
          {selectedCase.evidence.map((item) => (
            <span key={`${item.kind}-${item.label}`}>
              {item.kind.replaceAll("_", " ")} · {item.label}
            </span>
          ))}
          <span>related rail signals · {relatedEvents.length}</span>
          <span>CivilMCP citations · {mcpEvidenceCount}</span>
        </div>
        <p className="simulationCaveat">{simulation.caveat}</p>
        {localRecords.length > 0 ? (
          <div className="executionLog">
            <span>Rail action records</span>
            {localRecords.slice(0, 2).map((record) => (
              <p key={record.id}>
                <ClipboardCheck size={13} /> {record.title}
              </p>
            ))}
          </div>
        ) : null}
        <button className="primaryButton" type="button" onClick={onOpenResearch}>
          <SearchCheck size={15} />
          CivilMCP rail research
        </button>
      </div>
    </section>
  );
}

function AnalystPopup({
  open,
  brief,
  loading,
  onClose,
  onAnalyze,
  onOpenResearch,
}: {
  open: boolean;
  brief: AnalystBrief | null;
  loading: boolean;
  onClose: () => void;
  onAnalyze: () => void;
  onOpenResearch: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modalBackdrop analystBackdrop" role="dialog" aria-modal="true" aria-label="CivilMCP Analyst popup">
      <section className="analystWindow">
        <header className="modalHeader">
          <div>
            <span className="miniLabel">CivilMCP Analyst</span>
            <h2>Research-backed analysis</h2>
            <p>Use this window for quick analysis, then ask CivilMCP for cited evidence before action.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close CivilMCP Analyst">
            <X size={16} />
          </button>
        </header>
        <AnalystPanel
          brief={brief}
          loading={loading}
          onAnalyze={onAnalyze}
          onOpenResearch={onOpenResearch}
        />
      </section>
    </div>
  );
}

function defaultResearchQuestions(hotspot: SmartCityHotspot | null, relatedEvents: SmartCityEvent[]): ResearchQuestion[] {
  const name = hotspot?.name ?? "selected hotspot";
  const corridor = hotspot?.corridor ?? "selected corridor";
  const signal = relatedEvents[0]?.eventType.replace("_", " ") ?? "live incident";
  return [
    {
      id: "mechanism",
      question: `What crash mechanisms should operators investigate at ${name} on ${corridor}?`,
      reason: "Lock the safety mechanism before proposing action.",
    },
    {
      id: "intervention",
      question: `Which short-cycle interventions are supported for this ${signal} hotspot?`,
      reason: "Prefer reversible ops before infrastructure-heavy changes.",
    },
    {
      id: "evidence-risk",
      question: "What evidence connects traffic state, weather, speed, or queue spillback to accident severity?",
      reason: "Separate evidence from inference.",
    },
  ];
}

function ResearchWorkflowModal({
  open,
  hotspot,
  relatedEvents,
  workflow,
  loading,
  executionLog,
  onClose,
  onRunResearch,
  onExecute,
}: {
  open: boolean;
  hotspot: SmartCityHotspot | null;
  relatedEvents: SmartCityEvent[];
  workflow: ResearchWorkflowResponse | null;
  loading: boolean;
  executionLog: ActionProposal[];
  onClose: () => void;
  onRunResearch: () => void;
  onExecute: (proposal: ActionProposal) => void;
}) {
  if (!open) return null;

  const questions = workflow?.questions ?? defaultResearchQuestions(hotspot, relatedEvents);
  const executedIds = new Set(executionLog.map((item) => item.id));

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="CivilMCP hotspot analyst">
      <section className="researchModal">
        <header className="modalHeader">
          <div>
            <span className="miniLabel">CivilMCP Analyst</span>
            <h2>{hotspot?.name ?? "Selected hotspot"}</h2>
            <p title="Research questions to cited evidence review to ops action record.">Ask to evidence to record.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close hotspot analyst">
            <X size={16} />
          </button>
        </header>

        <div className="researchSteps">
          <span className={workflow ? "done" : "active"} title="Research questions">Ask</span>
          <span className={workflow ? "done" : ""} title="Analyze CivilMCP evidence">Evidence</span>
          <span title="Execute approved action">Record</span>
        </div>

        <section className="researchSection">
          <div className="sectionTitle">
            <ListChecks size={15} />
            <span>{compactSectionTitle("Questions to ask CivilMCP")}</span>
          </div>
          {questions.map((question) => (
            <div className="questionRow" key={question.id} title={`${question.question} · ${question.reason}`}>
              <strong>{question.question}</strong>
              <p>{question.reason}</p>
            </div>
          ))}
          <button className="primaryButton" type="button" onClick={onRunResearch} disabled={loading}>
            <SearchCheck size={15} />
            {loading ? "Researching CivilMCP..." : "Run CivilMCP research"}
          </button>
        </section>

        {workflow ? (
          <>
            <section className="researchSection">
              <div className="sectionTitle">
                <FileText size={15} />
                <span>{compactSectionTitle("Research findings")}</span>
              </div>
              {workflow.findings.map((finding) => (
                <div className="findingRow" key={finding.questionId} title={finding.answer}>
                  <strong>{finding.answer}</strong>
                  {finding.evidence.slice(0, 2).map((item) => (
                    <p key={item.id}>
                      <FileText size={13} /> {item.citation}
                    </p>
                  ))}
                </div>
              ))}
            </section>

            <section className="researchSection">
              <div className="sectionTitle">
                <ClipboardCheck size={15} />
                <span>{compactSectionTitle("Recommended actions")}</span>
              </div>
              {workflow.proposals.length > 0 ? (
                workflow.proposals.map((proposal) => (
                  <div className="proposalRow" key={proposal.id} title={`${proposal.title} · ${proposal.rationale}`}>
                    <div>
                      <strong>{proposal.title}</strong>
                      <p>{proposal.rationale}</p>
                      <span>Conf {Math.round(proposal.confidence * 100)}% · record</span>
                    </div>
                    <button className="secondaryButton" type="button" onClick={() => onExecute(proposal)} disabled={executedIds.has(proposal.id)}>
                      {executedIds.has(proposal.id) ? "Recorded" : "Record action"}
                    </button>
                  </div>
                ))
              ) : (
                <div className="emptyBrief">No recommended action generated because CivilMCP did not return direct cited evidence.</div>
              )}
            </section>

            <div className="limitations">
              {workflow.limitations.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function defaultRailQuestions(railCase: RailSafetyCase | null): ResearchQuestion[] {
  const name = railCase?.name ?? "selected SRT crossing";
  return [
    {
      id: "mechanism",
      question: `What failure mechanisms should be investigated at ${name}?`,
      reason: "Separate barrier timing, queue spillback, and driver compliance before action.",
    },
    {
      id: "intervention",
      question: "Which reversible level-crossing interventions are supported by research?",
      reason: "Prefer camera verification, warning lights, signal/barrier audit, and queue control first.",
    },
    {
      id: "effect",
      question: "Which before-after indicators should bound expected risk reduction?",
      reason: "Show simulation delta without claiming measured outcome.",
    },
  ];
}

function RailResearchModal({
  open,
  railCase,
  relatedEvents,
  workflow,
  loading,
  records,
  onClose,
  onRunResearch,
  onExecute,
}: {
  open: boolean;
  railCase: RailSafetyCase | null;
  relatedEvents: SmartCityEvent[];
  workflow: RailResearchWorkflowResponse | null;
  loading: boolean;
  records: RailActionRecord[];
  onClose: () => void;
  onRunResearch: () => void;
  onExecute: (proposal: RailActionProposal) => void;
}) {
  if (!open) return null;
  const questions = workflow?.questions ?? defaultRailQuestions(railCase);
  const executedIds = new Set(records.map((record) => record.proposalId));
  const canRecordRailAction = Boolean(workflow?.researchPersisted && workflow.researchRunId);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="CivilMCP rail analyst">
      <section className="researchModal railResearchModal">
        <header className="modalHeader">
          <div>
            <span className="miniLabel">CivilMCP Rail Analyst</span>
            <h2>{railCase?.name ?? "Selected SRT crossing"}</h2>
            <p title="Research evidence to recommended action to expected before/after risk delta.">Evidence to action to delta.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close rail analyst">
            <X size={16} />
          </button>
        </header>

        <div className="researchSteps">
          <span className={workflow ? "done" : "active"} title="Rail research questions">Ask</span>
          <span className={workflow ? "done" : ""} title="CivilMCP evidence split">Evidence</span>
          <span title="Controlled action">Record</span>
        </div>

        <section className="researchSection">
          <div className="sectionTitle">
            <ListChecks size={15} />
            <span>{compactSectionTitle("Questions to ask CivilMCP")}</span>
          </div>
          {questions.map((question) => (
            <div className="questionRow" key={question.id} title={`${question.question} · ${question.reason}`}>
              <strong>{question.question}</strong>
              <p>{question.reason}</p>
            </div>
          ))}
          <button className="primaryButton" type="button" onClick={onRunResearch} disabled={loading || !railCase}>
            <SearchCheck size={15} />
            {loading ? "Researching CivilMCP..." : "Run rail research"}
          </button>
        </section>

        <section className="researchSection">
          <div className="sectionTitle">
            <TrainFront size={15} />
            <span>{compactSectionTitle("Live/news signal")}</span>
          </div>
          {relatedEvents.length > 0 ? (
            relatedEvents.map((event) => (
              <div className="findingRow" key={event.id} title={`${event.title} · ${event.description}`}>
                <strong>{event.title}</strong>
                <p>{event.description}</p>
              </div>
            ))
          ) : (
            <div className="emptyBrief">No geocoded Thai rail news signal from configured real sources.</div>
          )}
        </section>

        {workflow ? (
          <>
            <section className="researchSection">
              <div className="sectionTitle">
                <FileText size={15} />
                <span>{compactSectionTitle("Evidence split")}</span>
              </div>
              {workflow.findings.map((finding) => (
                <div className="findingRow" key={finding.questionId} title={finding.answer}>
                  <span className="evidenceKind">{finding.kind.replaceAll("_", " ")}</span>
                  <strong>{finding.answer}</strong>
                  {finding.evidence.slice(0, 2).map((item) => (
                    <p key={item.id}>
                      <FileText size={13} /> {item.citation}
                    </p>
                  ))}
                </div>
              ))}
            </section>

            <section className="researchSection">
              <div className="sectionTitle">
                <GitCompareArrows size={15} />
                <span>{compactSectionTitle("Recommended action simulations")}</span>
              </div>
              {workflow.proposals.length > 0 ? (
                workflow.proposals.map((proposal) => (
                  <div className="proposalRow railProposalRow" key={proposal.id} title={`${proposal.title} · ${proposal.rationale} · ${proposal.simulation.caveat}`}>
                    <div>
                      <strong>{proposal.title}</strong>
                      <p>{proposal.rationale}</p>
                      <div className="proposalDelta">
                        <span>Before {proposal.simulation.beforeRisk}</span>
                        <span>After {proposal.simulation.afterExpectedRisk}</span>
                        <span>Delta {proposal.simulation.delta}</span>
                        <span>Conf {Math.round(proposal.simulation.confidence * 100)}%</span>
                      </div>
                      <p>{proposal.simulation.caveat}</p>
                    </div>
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => onExecute(proposal)}
                      disabled={!canRecordRailAction || executedIds.has(proposal.proposalId ?? proposal.id)}
                      title={
                        canRecordRailAction
                          ? "Record this persisted CivilMCP-gated rail action."
                          : "Rail action records require a persisted Research Gate run with cited mcp:* evidence."
                      }
                    >
                      {executedIds.has(proposal.proposalId ?? proposal.id) ? "Recorded" : canRecordRailAction ? "Record action" : "Gate required"}
                    </button>
                  </div>
                ))
              ) : (
                <div className="emptyBrief">No rail action simulation is shown until CivilMCP returns direct cited evidence.</div>
              )}
            </section>

            <div className="limitations">
              {workflow.limitations.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function ObjectAwareInsightPanel({
  insights,
  selectedInsight,
  records,
  onSelectInsight,
  onOpenResearch,
}: {
  insights: SmartCityInsight[];
  selectedInsight: SmartCityInsight | null;
  records: SmartCityActionRecord[];
  onSelectInsight: (id: string) => void;
  onOpenResearch: () => void;
}) {
  const localRecords = selectedInsight
    ? records.filter((record) => record.sourceObjectIds.some((objectId) => selectedInsight.sourceObjectIds.includes(objectId)))
    : [];

  return (
    <section className="ontologyPanel" aria-label="Object-aware actionable insights">
      <div className="sectionTitle">
        <SearchCheck size={15} />
        <span>Object-aware insights</span>
      </div>
      <p className="panelSubcopy">Ontology-lite · read-model only · MCP outside hot path</p>

      {insights.length === 0 ? (
        <div className="emptyBrief">
          No actionable insight is available from real-source provenance. Connect live transport/rail sources with healthy source status; no mock data is rendered.
        </div>
      ) : (
        <div className="ontologyInsightRows">
          {insights.slice(0, 5).map((insight) => (
            <button
              key={insight.id}
              type="button"
              className={`ontologyInsightButton ${selectedInsight?.id === insight.id ? "selected" : ""}`}
              onClick={() => onSelectInsight(insight.id)}
            >
              <strong>{insight.riskBefore}</strong>
              <span>
                <b>{insight.title}</b>
                <small>{insight.objectType.replaceAll("_", " ")} · {insight.evidence.length} evidence item(s)</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedInsight ? (
        <div className="ontologyFocus">
          <div className="railFocusHead">
            <div>
              <span className="miniLabel">{selectedInsight.objectType.replaceAll("_", " ")}</span>
              <h3>{selectedInsight.title}</h3>
              <p>{selectedInsight.whyNow}</p>
            </div>
            <span className={severityClass(selectedInsight.severity)}>{selectedInsight.severity}</span>
          </div>
          <div className="simulationGrid">
            <div>
              <span>Before risk</span>
              <strong>{selectedInsight.riskBefore}</strong>
            </div>
            <div>
              <span>Expected after</span>
              <strong>{selectedInsight.expectedRiskAfter}</strong>
            </div>
            <div>
              <span>Delta</span>
              <strong>{selectedInsight.delta}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{Math.round(selectedInsight.confidence * 100)}%</strong>
            </div>
          </div>
          <div className="ontologyEvidenceChips">
            {selectedInsight.evidence.slice(0, 4).map((item) => (
              <span key={item.id}>{item.kind.replaceAll("_", " ")} · {item.label}</span>
            ))}
          </div>
          <p className="simulationCaveat">{selectedInsight.caveat}</p>
          <p>{selectedInsight.nextVerificationStep}</p>
          <button className="primaryButton" type="button" onClick={onOpenResearch}>
            <SearchCheck size={15} />
            CivilMCP
          </button>
          {localRecords.length > 0 ? (
            <div className="executionLog">
              <span>Object action records</span>
              {localRecords.slice(0, 2).map((record) => (
                <p key={record.id}>
                  <ClipboardCheck size={13} /> {record.title}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ActionLogPanel({ records }: { records: SmartCityActionRecord[] }) {
  return (
    <section className="actionLogPanel" aria-label="Decision capture action log">
      <div className="sectionTitle">
        <ClipboardCheck size={15} />
        <span>Decision capture</span>
      </div>
      {records.length === 0 ? (
        <div className="emptyBrief">No ops action record yet. Action recording requires cited MCP evidence.</div>
      ) : (
        <div className="actionRecordRows">
          {records.slice(0, 4).map((record) => (
            <div className="actionRecordRow" key={record.id}>
              <strong>{record.title}</strong>
              <span>
                {record.actionType.replaceAll("_", " ")} · {record.actor} · {formatTime(record.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MapControlStack({
  mapRef,
  fullscreen,
  onToggleFullscreen,
}: {
  mapRef: { current: MapLibreMap | null };
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <>
      <div className="mapToolStack" aria-label="Map tools">
        <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={20} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={20} />
        </button>
        <button type="button" aria-label="Reset bearing" onClick={() => mapRef.current?.resetNorth()}>
          <Crosshair size={18} />
        </button>
        <button type="button" aria-label={fullscreen ? "Exit fullscreen map" : "Fullscreen map"} onClick={onToggleFullscreen} aria-pressed={fullscreen}>
          <Maximize2 size={18} />
        </button>
      </div>
      <div className="mapScale">
        <strong>5 km</strong>
        <span>© MapLibre</span>
      </div>
      <div className="weatherLegend">
        <span>Rainfall intensity (mm/h)</span>
        <div className="legendGradient" />
        <div className="legendTicks">
          <small>0.2</small>
          <small>1</small>
          <small>5</small>
          <small>10</small>
          <small>25</small>
          <small>50</small>
          <small>100+</small>
        </div>
      </div>
    </>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const bars = Math.max(0, Math.min(5, Math.round(value * 5)));
  return (
    <span className="confidenceMeter" aria-label={`confidence ${Math.round(value * 100)} percent`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <i key={index} className={index < bars ? "on" : ""} />
      ))}
    </span>
  );
}

function WorkspaceHeader({
  activeWorkspace,
  itemCount,
  activeTool,
  loading,
}: {
  activeWorkspace: WorkspaceKey;
  itemCount: number;
  activeTool: ToolKey | null;
  loading: boolean;
}) {
  const meta = WORKSPACE_META[activeWorkspace];
  const Icon = meta.icon;
  return (
    <section className="workspaceHeader" aria-label="Active workspace">
      <div>
        <Icon size={16} />
        <strong title={meta.label}>{meta.label}</strong>
        <span title={loading ? "loading" : `${itemCount} real item${itemCount === 1 ? "" : "s"}`}>
          {loading ? "load" : `${itemCount} real`}
        </span>
      </div>
      <div className="workspaceChips">
        <span title="Real data only">Real</span>
        <span title={activeTool ? `${TOOL_META[activeTool].label} active` : "No map tool"}>
          {activeTool ? compactToolLabel(activeTool) : "No tool"}
        </span>
      </div>
    </section>
  );
}

function WorkspaceStrip({
  activeWorkspace,
  items,
  onFocusItem,
}: {
  activeWorkspace: WorkspaceKey;
  items: WorkspaceItem[];
  onFocusItem: (item: WorkspaceItem) => void;
}) {
  if (activeWorkspace === "overview") return null;
  return (
    <section className="workspaceStrip" aria-label={`${WORKSPACE_META[activeWorkspace].label} workspace items`}>
      <div className="workspaceStripHeader">
        <strong title={WORKSPACE_META[activeWorkspace].label}>{WORKSPACE_META[activeWorkspace].label}</strong>
        <span title={items.length === 0 ? "No matching real data" : `${items.length} shown`}>{items.length === 0 ? "0" : `${items.length}`}</span>
      </div>
      <div className="workspaceItemRows">
        {items.length === 0 ? <div className="emptyBrief compactEmpty">No real item is available for this workspace.</div> : null}
        {items.slice(0, 7).map((item) => (
          <button
            key={item.id}
            type="button"
            className="workspaceItemRow"
            onClick={() => onFocusItem(item)}
            aria-label={`${item.title}. ${item.meta}`}
            title={`${item.title} · ${item.meta} · ${item.id}`}
          >
            <span className={item.severity ? severityClass(item.severity) : "workspaceDot"}>{item.severity ?? "item"}</span>
            <strong>{item.title}</strong>
            <small>{compactWorkspaceMeta(item.meta)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function UtilityDrawer({
  openPopover,
  stats,
  overview,
  railOverview,
  sourceSla,
  actionRecords,
  onClose,
}: {
  openPopover: PopoverKey;
  stats: TopStats;
  overview: OpsOverview | null;
  railOverview: RailOverview | null;
  sourceSla: OpsSourceSlaResponse | null;
  actionRecords: SmartCityActionRecord[];
  onClose: () => void;
}) {
  if (!openPopover || openPopover === "command" || openPopover === "tool") return null;
  const sources = [...(overview?.sourceHealth ?? []), ...(railOverview?.sourceHealth ?? [])];
  const title =
    openPopover === "region"
      ? "Region"
      : openPopover === "alerts"
        ? "Live alerts"
        : openPopover === "help"
          ? "Operations help"
          : "Session";
  return (
    <aside className="utilityDrawer" aria-label={`${title} drawer`}>
      <div className="drawerHeader">
        <strong title={title}>{compactDrawerLabel(title)}</strong>
        <button className="iconButton" type="button" onClick={onClose} aria-label={`Close ${title}`}>
          <X size={15} />
        </button>
      </div>
      {openPopover === "region" ? (
        <div className="drawerRows">
          <div className="drawerRow active" title={`Bangkok pilot · ${stats.activeSources}/${stats.totalSources} sources connected · ICT timezone`}>
            <strong>BKK</strong>
            <span>{stats.activeSources}/{stats.totalSources} sources · ICT</span>
          </div>
          <div className="drawerRow disabled" title="Thailand national view requires configured national feed coverage before activation.">
            <strong>Thailand</strong>
            <span>Needs national feeds</span>
          </div>
        </div>
      ) : null}
      {openPopover === "alerts" ? (
        <div className="drawerRows">
          {buildWorkspaceItems({ key: "alerts", overview, railOverview, ontology: null, insights: [], actionRecords }).slice(0, 8).map((item) => (
            <div className="drawerRow" key={item.id} title={`${item.title} · ${item.meta} · ${item.id}`}>
              <strong>{shortRecordTitle(item.title)}</strong>
              <span>{compactWorkspaceMeta(item.meta)}</span>
            </div>
          ))}
          {(sourceSla?.sources ?? [])
            .filter((source) => source.slaState !== "ok")
            .slice(0, 4)
            .map((source) => (
              <div className="drawerRow" key={`sla-${source.sourceId}`} title={`${source.name} · ${source.slaState} · ${source.breachReasons.join(", ") || "source SLA warning"}`}>
                <strong>{compactSourceName(source.name)}</strong>
                <span>{source.slaState} · {source.breachReasons[0] ?? source.status}</span>
              </div>
            ))}
          {stats.liveIncidents === 0 && stats.weatherSeverity === "none" && (sourceSla?.summary.breach ?? 0) === 0 && (sourceSla?.summary.warn ?? 0) === 0 ? (
            <div className="emptyBrief compactEmpty">No live incident, weather, or source SLA alert from real sources.</div>
          ) : null}
        </div>
      ) : null}
      {openPopover === "help" ? (
        <div className="drawerRows">
          <div className="drawerRow" title="Select object, ask CivilMCP, verify citations, then record the approved action.">
            <strong>Workflow</strong>
            <span>Object to MCP to Record</span>
          </div>
          <div className="drawerRow" title="Search, measure, draw, bookmarks, layers are local dashboard tools.">
            <strong>Tools</strong>
            <span>Local only</span>
          </div>
          <div className="drawerRow" title="Markers and counts come from real API/read-model payloads only.">
            <strong>Provenance</strong>
            <span>Real payload</span>
          </div>
        </div>
      ) : null}
      {openPopover === "user" ? (
        <div className="drawerRows">
          <div className="drawerRow" title="Ops dashboard · read-only CivilMCP analysis">
            <strong>Env</strong>
            <span>Ops · MCP read-only</span>
          </div>
          <div className="drawerRow" title={`${actionRecords.length} persisted ops records loaded`}>
            <strong>Records</strong>
            <span>{actionRecords.length} loaded</span>
          </div>
          <div className="drawerRow" title={`${sources.filter((source) => source.status === "ok" || source.status === "degraded").length}/${sources.length} connected`}>
            <strong>Sources</strong>
            <span>{sources.filter((source) => source.status === "ok" || source.status === "degraded").length}/{sources.length}</span>
          </div>
          <div className="drawerRow" title={`Source SLA: ${sourceSla?.summary.ok ?? 0} ok, ${sourceSla?.summary.warn ?? 0} warn, ${sourceSla?.summary.breach ?? 0} breach`}>
            <strong>SLA</strong>
            <span>{sourceSla ? `${sourceSla.summary.ok}/${sourceSla.summary.total} ok · ${sourceSla.summary.breach} breach` : "not loaded"}</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function CommandPalette({
  open,
  query,
  items,
  onQueryChange,
  onClose,
  onFocusItem,
}: {
  open: boolean;
  query: string;
  items: WorkspaceItem[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onFocusItem: (item: WorkspaceItem) => void;
}) {
  if (!open) return null;
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? items.filter((item) => `${item.title} ${item.meta} ${item.id}`.toLowerCase().includes(normalized)).slice(0, 12)
    : items.slice(0, 12);
  return (
    <section className="commandPalette" aria-label="Search command palette">
      <div className="drawerHeader">
        <strong>Search</strong>
        <button className="iconButton" type="button" onClick={onClose} aria-label="Close search">
          <X size={15} />
        </button>
      </div>
      <label className="commandSearch">
        <Search size={15} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Events, assets, sources" autoFocus />
      </label>
      <div className="commandResults">
        {filtered.length === 0 ? <div className="emptyBrief compactEmpty">No matching real object in the loaded read model.</div> : null}
        {filtered.map((item) => (
          <button key={item.id} type="button" onClick={() => onFocusItem(item)} aria-label={`${item.title}. ${item.meta}`} title={`${item.title} · ${item.meta} · ${item.id}`}>
            <strong>{item.title}</strong>
            <span>{compactWorkspaceMeta(item.meta)} · {shortResourceId(item.id)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ToolPanel({
  activeTool,
  layerCounts,
  bookmarkItems,
  onClose,
}: {
  activeTool: ToolKey | null;
  layerCounts: LayerCounts;
  bookmarkItems: WorkspaceItem[];
  onClose: () => void;
}) {
  if (!activeTool || activeTool === "search") return null;
  const meta = TOOL_META[activeTool];
  return (
    <section className="toolPanel" aria-label={`${meta.label} tool panel`}>
      <div className="drawerHeader">
        <strong>{meta.label}</strong>
        <button className="iconButton" type="button" onClick={onClose} aria-label={`Close ${meta.label}`}>
          <X size={15} />
        </button>
      </div>
      {activeTool === "measure" ? (
        <div className="drawerRow" title="Local mode only. Use the map scale and selected object geometry for distance review; no field system is changed.">
          <strong>Measure</strong>
          <span>Local only</span>
        </div>
      ) : null}
      {activeTool === "draw" ? (
        <div className="drawerRow" title="Local annotation mode. Notes are not persisted and no external action is triggered.">
          <strong>Draw</strong>
          <span>No persist</span>
        </div>
      ) : null}
      {activeTool === "bookmarks" ? (
        <div className="drawerRows">
          {bookmarkItems.slice(0, 4).map((item) => (
            <div className="drawerRow" key={item.id} title={`${item.title} · ${item.meta} · ${item.id}`}>
              <strong>{shortRecordTitle(item.title)}</strong>
              <span>{compactWorkspaceMeta(item.meta)}</span>
            </div>
          ))}
          {bookmarkItems.length === 0 ? <div className="emptyBrief compactEmpty">No current real object bookmarks are available.</div> : null}
        </div>
      ) : null}
      {activeTool === "layers" ? (
        <div className="drawerRows">
          {(Object.keys(layerCounts) as LayerKey[]).map((key) => (
            <div className="drawerRow" key={key} title={`${LAYER_LABELS[key].label}: ${layerCounts[key]} real item${layerCounts[key] === 1 ? "" : "s"} in current payload`}>
              <strong>{compactLayerLabel(key)}</strong>
              <span>{layerCounts[key]} real</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function sanitizeResourceLocator(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\-._]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function resourceIdentifier(dossier: SelectedDossier) {
  if (dossier.kind === "empty") return "No selected resource";
  const type = dossier.kind.replaceAll("_", "-");
  const locator = sanitizeResourceLocator(dossier.id) || "unresolved";
  return `ri.smart-city.th.${type}.${locator}`;
}

function evidenceLedgerCounts(dossier: SelectedDossier, selectedInsight: SmartCityInsight | null, analystBrief: AnalystBrief | null) {
  const counts = {
    live: dossier.kind === "empty" ? 0 : 1,
    historical: 0,
    mcp: analystBrief?.evidence.length ?? 0,
    inference: analystBrief?.guidance.length ?? 0,
  };

  for (const item of selectedInsight?.evidence ?? []) {
    if (item.kind === "live_data") counts.live += 1;
    if (item.kind === "historical_baseline") counts.historical += 1;
    if (item.kind === "mcp_research") counts.mcp += 1;
    if (item.kind === "inference") counts.inference += 1;
  }

  return counts;
}

function deriveOsirisCoverage(sourceHealth: SourceHealth[]) {
  const feeds = sourceHealth.filter((source) => source.sourceId.startsWith("osiris-"));
  const liveFeeds = feeds.filter((source) => source.status === "ok" || source.status === "degraded");
  return {
    totalFeeds: feeds.length,
    liveFeeds: liveFeeds.length,
    mappedRows: feeds.reduce((sum, source) => sum + source.recordCount, 0),
    blockedFeeds: feeds.filter((source) => source.status === "offline" || source.status === "needs_config").length,
    topFeeds: [...liveFeeds].sort((a, b) => b.recordCount - a.recordCount).slice(0, 3),
  };
}

function OperatingModelPanel({ sourceHealth, insights }: { sourceHealth: SourceHealth[]; insights: SmartCityInsight[] }) {
  const coverage = deriveOsirisCoverage(sourceHealth);
  const patterns = [
    { label: "Ops UI", value: "dense controls" },
    { label: "Resource ID", value: "object identity" },
    { label: "Timeline", value: "composable signals" },
    { label: "Read model", value: "fast insight path" },
  ];

  return (
    <section className="dockSection inspirationDock" aria-label="Operations architecture">
      <div className="dockHeader">
        <h2>Operating model</h2>
        <strong>{insights.length} insights</strong>
      </div>
      <div className="inspirationGrid">
        {patterns.map((pattern) => (
          <span key={pattern.label}>
            <b>{pattern.label}</b>
            <small>{pattern.value}</small>
          </span>
        ))}
      </div>
      <div className="osirisCoverage">
        <div>
          <span>Osiris passive coverage</span>
          <strong>
            {coverage.liveFeeds}/{coverage.totalFeeds}
          </strong>
          <small>{coverage.mappedRows} mapped rows · {coverage.blockedFeeds} blocked/offline</small>
        </div>
        {coverage.topFeeds.length === 0 ? (
          <p>No live Osiris passive feed is healthy in the current read model.</p>
        ) : (
          coverage.topFeeds.map((feed) => (
            <p key={feed.sourceId}>
              <DatabaseZap size={12} /> {feed.name}: {feed.recordCount} rows
            </p>
          ))
        )}
      </div>
    </section>
  );
}

function ObjectActionQueue({
  insights,
  selectedInsight,
  onSelectInsight,
}: {
  insights: SmartCityInsight[];
  selectedInsight: SmartCityInsight | null;
  onSelectInsight: (id: string) => void;
}) {
  return (
    <section className="dockSection actionQueueDock">
      <div className="dockHeader">
        <h2>Object action queue</h2>
        <strong>{insights.length}</strong>
      </div>
      {insights.length === 0 ? (
        <div className="emptyBrief compactEmpty">No real-source actionable insight is available from the read model.</div>
      ) : (
        <div className="queueRows">
          {insights.slice(0, 5).map((insight) => (
            <button
              key={insight.id}
              type="button"
              className={`queueRow ${selectedInsight?.id === insight.id ? "selected" : ""}`}
              onClick={() => onSelectInsight(insight.id)}
            >
              <strong>{insight.riskBefore}</strong>
              <span>
                <b>{insight.title}</b>
                <small>
                  {insight.objectType.replaceAll("_", " ")} · {insight.evidence.length} evidence · after {insight.expectedRiskAfter}
                </small>
              </span>
              <ConfidenceMeter value={insight.confidence} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function OpsDock({
  dossier,
  overview,
  railOverview,
  sourceSla,
  selectedSourceId,
  selectedInsight,
  researchGateResponse,
  analystBrief,
  analystLoading,
  actionRecords,
  railRecords,
  executionLog,
  mapCommandLog,
  onAnalyze,
  onOpenResearch,
  onOpenOntologyResearch,
  onOpenRailResearch,
  onSelectSource,
  onDockInteract,
}: {
  dossier: SelectedDossier;
  overview: OpsOverview | null;
  railOverview: RailOverview | null;
  sourceSla: OpsSourceSlaResponse | null;
  selectedSourceId: string | null;
  selectedInsight: SmartCityInsight | null;
  researchGateResponse: ResearchGateResponse | null;
  analystBrief: AnalystBrief | null;
  analystLoading: boolean;
  actionRecords: SmartCityActionRecord[];
  railRecords: RailActionRecord[];
  executionLog: ActionProposal[];
  mapCommandLog: OpsMapCommandEnvelope[];
  onAnalyze: () => void;
  onOpenResearch: () => void;
  onOpenOntologyResearch: () => void;
  onOpenRailResearch: () => void;
  onSelectSource: (id: string) => void;
  onDockInteract: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DockTab>("dossier");
  const sources = [...(overview?.sourceHealth ?? []), ...(railOverview?.sourceHealth ?? [])];
  const selectedSource = sources.find((source) => source.sourceId === selectedSourceId) ?? null;
  const sourceSlaById = new Map((sourceSla?.sources ?? []).map((source) => [source.sourceId, source]));
  const selectedSourceSla = selectedSource ? sourceSlaById.get(selectedSource.sourceId) ?? null : null;
  const cameraAsset = overview?.assets.find((asset) => asset.assetType === "camera");
  const cameraUrl =
    typeof cameraAsset?.attributes.feedUrl === "string"
      ? cameraAsset.attributes.feedUrl
      : typeof cameraAsset?.attributes.sourceUrl === "string"
        ? cameraAsset.attributes.sourceUrl
        : undefined;
  const analystRows = analystBrief
    ? analystBrief.guidance.slice(0, 4).map((item, index) => ({
        id: `${index}-${item}`,
        title: item,
        confidence: Math.max(0.45, Math.min(0.92, (analystBrief.evidence.length + 2 - index) / 6)),
      }))
    : selectedInsight
      ? [
          { id: selectedInsight.id, title: selectedInsight.recommendedAction, confidence: selectedInsight.confidence },
          { id: `${selectedInsight.id}-verify`, title: selectedInsight.nextVerificationStep, confidence: Math.max(0.35, selectedInsight.confidence - 0.12) },
        ]
      : [];
  const totalRecords = actionRecords.length + railRecords.length + executionLog.length;
  const ri = resourceIdentifier(dossier);
  const evidenceCounts = evidenceLedgerCounts(dossier, selectedInsight, analystBrief);

  return (
    <aside className="opsDock" aria-label="Incident and analyst operations dock" onPointerDownCapture={onDockInteract}>
      <div className="dockTabs" role="tablist" aria-label="Object panel sections">
        {(["dossier", "analyst", "sources", "actions"] as DockTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "active" : ""}
            onClick={() => {
              onDockInteract();
              setActiveTab(tab);
            }}
            aria-pressed={activeTab === tab}
            aria-label={tab === "dossier" ? "Case dossier" : tab === "analyst" ? "CivilMCP analyst" : tab === "sources" ? "Sources" : "Action log"}
            title={tab === "dossier" ? "Case dossier" : tab === "analyst" ? "CivilMCP analyst" : tab === "sources" ? "Sources" : "Action log"}
          >
            {tab === "dossier" ? "Case" : tab === "analyst" ? "AI" : tab === "sources" ? "Src" : "Log"}
          </button>
        ))}
      </div>

      {activeTab === "dossier" ? (
      <section className="dockSection dossierDock">
        <div className="dockHeader">
          <h2>Case dossier</h2>
          <ChevronDown size={15} />
        </div>
        {dossier.kind === "empty" ? (
          <div className="emptyBrief">No selected real object. Select a live marker, hotspot, rail case, or actionable insight.</div>
        ) : (
          <>
            <div className="dossierCompactHead">
              <span className={severityClass(dossier.severity)}>{dossier.severity === "none" ? "no data" : dossier.severity}</span>
              <code title={dossier.id}>#{shortResourceId(dossier.id)}</code>
            </div>
            <h3>{dossier.title}</h3>
            <p>{dossier.subtitle}</p>
            <div className="resourceIdentity">
              <span>Resource</span>
              <code title={ri}>{shortResourceId(ri)}</code>
            </div>
            <div className="workflowRail" aria-label="Object workflow">
              <span className="done">Object</span>
              <span className={dossier.sourceUrl ? "done" : ""}>Sources</span>
              <span className={selectedInsight || analystBrief ? "done" : ""}>Evidence</span>
            </div>
            <div className="dockFieldGrid">
              {dossier.fields.map((field) => (
                <div className="fieldRow" key={field.label}>
                  <span title={field.label}>{compactDossierLabel(field.label)}</span>
                  <strong title={field.value}>{field.label === "Object ID" || field.label === "Crossing asset" ? shortResourceId(field.value) : field.value}</strong>
                </div>
              ))}
              <div className="fieldRow">
                <span title="Severity">Sev</span>
                <strong>{dossier.severity}</strong>
              </div>
              <div className="fieldRow">
                <span title="Confidence">Conf</span>
                <strong>{dossier.confidence == null ? "not scored" : Math.round(dossier.confidence * 100) + "%"}</strong>
              </div>
              <div className="fieldRow">
                <span title="Sources">Src</span>
                <strong>{dossier.sourceUrl ? "linked" : "provenance only"}</strong>
              </div>
              <div className="fieldRow">
                <span title="Last update">Updated</span>
                <strong>{formatDateTime(dossier.updatedAt)}</strong>
              </div>
            </div>
            <div className="cameraFrame">
              {cameraUrl ? (
                <a href={cameraUrl} target="_blank" rel="noreferrer">
                  {cameraAsset?.name ?? "Verified camera feed"} · Open source feed
                </a>
              ) : (
                <span>No verified camera preview connected</span>
              )}
            </div>
          </>
        )}
      </section>
      ) : null}

      {activeTab === "analyst" ? (
      <section className="dockSection analystDock">
        <div className="dockHeader">
          <h2>CivilMCP Analyst</h2>
          <span className="readOnlyPill">Read-only MCP</span>
        </div>
        <p className="panelSubcopy" title="Ask for a cited action plan on the selected object.">Cited action plan.</p>
        <div className="evidenceLedger" aria-label="Evidence ledger">
          <span>
            <b>{evidenceCounts.live}</b>
            <small>live</small>
          </span>
          <span>
            <b>{evidenceCounts.historical}</b>
            <small>baseline</small>
          </span>
          <span>
            <b>{evidenceCounts.mcp}</b>
            <small>MCP</small>
          </span>
          <span>
            <b>{evidenceCounts.inference}</b>
            <small>inference</small>
          </span>
        </div>
        {selectedInsight ? (
          <div className="mcpIntentCard">
            <span>Decision</span>
            <strong title={selectedInsight.recommendedAction}>{shortRecordTitle(selectedInsight.recommendedAction)}</strong>
            <p title={selectedInsight.nextVerificationStep}>{selectedInsight.nextVerificationStep}</p>
          </div>
        ) : null}
        <div className="sequencePreview" aria-label="Decision sequence preview">
          <span className={dossier.kind !== "empty" ? "active" : ""}>Obj</span>
          <span className={selectedInsight || analystBrief ? "active" : ""}>Evd</span>
          <span className={selectedInsight ? "active" : ""}>Act</span>
          <span className={totalRecords > 0 ? "active" : ""}>Log</span>
        </div>
        <div className="dockButtonRow">
          <button className="primaryButton" type="button" onClick={selectedInsight ? onOpenOntologyResearch : onOpenResearch}>
            <SearchCheck size={15} />
            Ask CivilMCP
          </button>
          <button className="secondaryButton" type="button" onClick={onAnalyze} disabled={analystLoading || dossier.kind === "empty"}>
            {analystLoading ? "Analyzing..." : "Quick analyze"}
          </button>
        </div>
        {analystRows.length > 0 ? (
          <div className="analystActionRows">
            {analystRows.map((row, index) => (
              <div className="analystActionRow" key={row.id}>
                <span>{index + 1}</span>
                <strong>{row.title}</strong>
                <ConfidenceMeter value={row.confidence} />
              </div>
            ))}
          </div>
        ) : (
          <div className="emptyBrief compactEmpty">Select object, ask MCP, verify evidence.</div>
        )}
        {researchGateResponse?.workflowTrace?.length ? (
          <div className="workflowTraceDock" aria-label="Latest workflow trace">
            {researchGateResponse.workflowTrace.map((step) => (
              <span key={step.id} className={`traceStep trace-${step.status}`} title={`${step.label}: ${step.summary}`}>
                <b>{step.label}</b>
                <small>{step.status}</small>
              </span>
            ))}
          </div>
        ) : null}
        {mapCommandLog.length > 0 ? (
          <div className="workflowTraceDock" aria-label="Latest map command run log">
            {mapCommandLog.slice(0, 4).map((item) => (
              <span key={item.commandId} className={`traceStep trace-${item.status === "applied" ? "complete" : item.status === "pending" ? "pending" : "blocked"}`} title={`${item.command.type}: ${item.command.reason}`}>
                <b>{item.command.type.replaceAll("_", " ")}</b>
                <small>{item.status}</small>
              </span>
            ))}
          </div>
        ) : null}
        <div className="dockLinks">
          <button type="button" onClick={onOpenResearch}>
            Hotspot analysis
          </button>
          <button type="button" onClick={onOpenRailResearch} disabled={(railOverview?.cases.length ?? 0) === 0}>
            Rail crossing analysis
          </button>
        </div>
      </section>
      ) : null}

      {activeTab === "sources" ? (
        <section className="dockSection compactRailState">
          <div className="dockHeader">
            <h2>Source status</h2>
            <strong title={sourceSla ? `${sourceSla.summary.ok} ok · ${sourceSla.summary.warn} warn · ${sourceSla.summary.breach} breach` : `${sources.length} sources`}>
              {sourceSla ? `${sourceSla.summary.breach} breach` : sources.length}
            </strong>
          </div>
          {selectedSource ? (
            <div className="selectedSourceCard">
              <span title={selectedSource.sourceId}>{shortResourceId(selectedSource.sourceId)}</span>
              <strong title={selectedSource.name}>{compactSourceName(selectedSource.name)}</strong>
              <p title={`${selectedSource.provider} · ${selectedSource.status} · ${dataClassLabel(selectedSource)} · ${selectedSource.recordCount} real rows · last success ${formatTime(selectedSource.lastSuccessAt)}`}>
                {selectedSource.provider} · {selectedSource.status} · {dataClassLabel(selectedSource)} · {selectedSource.recordCount} real rows · last success{" "}
                {formatTime(selectedSource.lastSuccessAt)}
              </p>
              {selectedSourceSla ? (
                <p title={`SLA ${selectedSourceSla.slaState}: ${selectedSourceSla.breachReasons.join(", ") || "within threshold"}`}>
                  SLA {selectedSourceSla.slaState} · p95 {selectedSourceSla.p95LatencyMs24h ?? "n/a"} ms ·{" "}
                  {selectedSourceSla.successRate24h == null ? "n/a" : Math.round(selectedSourceSla.successRate24h * 100) + "%"} success
                </p>
              ) : null}
            </div>
          ) : null}
          {sources.length === 0 ? (
            <p>No connected real source is available.</p>
          ) : (
            <div className="dockSourceRows">
              {sources.slice(0, 10).map((source) => (
                <button
                  className={`dockSourceRow ${selectedSourceId === source.sourceId ? "selected" : ""}`}
                  key={source.sourceId}
                  type="button"
                  onClick={() => onSelectSource(source.sourceId)}
                  aria-pressed={selectedSourceId === source.sourceId}
                  aria-label={`${source.name}: ${source.status}, ${dataClassLabel(source)}, ${source.recordCount} rows`}
                  title={`${source.name} · ${source.provider} · ${source.status} · ${dataClassLabel(source)} · ${source.recordCount} rows · SLA ${sourceSlaById.get(source.sourceId)?.slaState ?? "n/a"} · ${formatTime(source.lastSuccessAt)}`}
                >
                  <span className={`sourceStatus source-${source.status}`}>{statusIcon(source.status)}</span>
                  <strong>{compactSourceName(source.name)}</strong>
                  <small>
                    {source.status} · {compactDataClassLabel(source)} · {sourceSlaById.get(source.sourceId)?.slaState ?? "sla n/a"}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "actions" ? (
        <section className="dockSection actionTrail">
          <div className="dockHeader">
            <h2>Action log</h2>
            <strong>{totalRecords}</strong>
          </div>
          {actionRecords.slice(0, 4).map((record) => (
            <p key={record.id} title={`${record.title} · ${record.actor} · ${record.status} · ${formatTime(record.createdAt)} · ${record.sourceObjectIds.join(" · ")}`}>
              <ClipboardCheck size={13} /> <span>{shortRecordTitle(record.title)}</span> <small>{record.status} · {formatTime(record.createdAt)}</small>
            </p>
          ))}
          {railRecords.slice(0, 3).map((record) => (
            <p key={record.id} title={`${record.title} · local rail record · ${formatTime(record.createdAt)}`}>
              <ClipboardCheck size={13} /> <span>{shortRecordTitle(record.title)}</span> <small>rail · {formatTime(record.createdAt)}</small>
            </p>
          ))}
          {totalRecords === 0 ? <p>No local action record yet.</p> : null}
        </section>
      ) : null}
    </aside>
  );
}

function findingFor(response: ResearchGateResponse | null, kind: ResearchGateFinding["kind"]) {
  return response?.findings.find((finding) => finding.kind === kind) ?? null;
}

function proposalSequence(proposal: ResearchGateProposal | null, insight: SmartCityInsight | null) {
  const action = proposal?.title ?? insight?.recommendedAction ?? "No action is executable until cited evidence is available.";
  return [
    {
      label: "Verify live object",
      detail: insight?.nextVerificationStep ?? "Confirm a real selected object and source provenance before making an operations call.",
    },
    {
      label: "Check cited evidence",
      detail: proposal ? "Use CivilMCP citations to bound the intervention and reject unsupported claims." : "CivilMCP has not returned direct citations for an executable recommendation.",
    },
    {
      label: "Record action",
      detail: action,
    },
    {
      label: "Monitor expected delta",
      detail: proposal
        ? `Track risk ${proposal.riskBefore} -> ${proposal.expectedRiskAfter}; this is expected reduction, not measured outcome.`
        : "Keep risk unchanged until cited evidence supports a reversible action.",
    },
  ];
}

function OntologyResearchGateModal({
  open,
  insight,
  response,
  loading,
  error,
  records,
  onClose,
  onRunResearch,
  onRecord,
}: {
  open: boolean;
  insight: SmartCityInsight | null;
  response: ResearchGateResponse | null;
  loading: boolean;
  error: string | null;
  records: SmartCityActionRecord[];
  onClose: () => void;
  onRunResearch: () => void;
  onRecord: (proposal: ResearchGateProposal) => void;
}) {
  if (!open) return null;
  const recordedEvidence = new Set(records.flatMap((record) => record.evidenceIds));
  const proposal = response?.recommendedActions[0] ?? null;
  const liveFinding = findingFor(response, "live_data");
  const baselineFinding = findingFor(response, "historical_baseline");
  const researchFinding = findingFor(response, "mcp_research");
  const inferenceFinding = findingFor(response, "inference");
  const sequence = proposalSequence(proposal, insight);
  const proposalAlreadyRecorded = proposal
    ? records.some((record) => record.researchRunId === response?.researchRunId && record.proposalId === proposal.proposalId) ||
      proposal.evidenceIds.some((id) => recordedEvidence.has(id))
    : false;
  const proposalRecordable = Boolean(response?.researchPersisted && proposal?.recordable && proposal.proposalId);
  const recordDisabledReason = !response?.researchPersisted
    ? "Research run is not persisted, so no action can be recorded."
    : !proposal?.proposalId
      ? "Server proposal id is missing."
      : !proposal.recordable
        ? "Proposal has no direct or indirect CivilMCP evidence."
        : "";
  const evidenceUseRows = response?.evidenceUse ?? [];
  const actionableEvidenceCount = evidenceUseRows.filter((item) => item.evidenceStrength !== "context_only").length;
  const gateStatus = loading ? "Querying MCP" : error ? "Needs attention" : response?.mode === "mcp_read_only" ? "Cited evidence" : response ? "Offline evidence" : "Ready";
  const sourceObjectPreview = insight?.sourceObjectIds.slice(0, 2).map(shortResourceId).join(" · ") ?? "No linked object";
  const gateSteps = [
    {
      label: "Object locked",
      detail: insight ? `${insight.objectType.replaceAll("_", " ")} · ${shortResourceId(insight.objectId)}` : "Select a real-source object first.",
      state: insight ? "done" : "blocked",
    },
    {
      label: "MCP retrieval",
      detail: loading ? "Reading CivilMCP transport evidence in read-only mode." : response ? `${response.findings.length} evidence groups returned.` : "Ready to query CivilMCP.",
      state: loading ? "active" : response ? "done" : error ? "blocked" : "pending",
    },
    {
      label: "Citation check",
      detail: response ? `${actionableEvidenceCount} actionable citation link(s), ${evidenceUseRows.length} total citation map row(s).` : "Action remains locked until cited evidence returns.",
      state: response ? (actionableEvidenceCount > 0 ? "done" : "blocked") : "pending",
    },
    {
      label: "Action record",
      detail: proposal ? proposal.title : "No record is created during research.",
      state: proposal ? "done" : response ? "blocked" : "pending",
    },
  ];

  return (
    <div className="modalBackdrop gateBackdrop" role="dialog" aria-modal="true" aria-label="CivilMCP action planner">
      <section className={`researchModal ontologyResearchModal actionPlannerModal ${response ? "hasResponse" : "compactGate"}`}>
        <header className="modalHeader gateHeader">
          <div>
            <span className="miniLabel">CivilMCP Analyst</span>
            <h2 title={insight?.title ?? "Selected ontology object"}>{insight?.title ?? "Selected ontology object"}</h2>
            <p title={insight ? `${insight.sourceObjectIds.length} source objects · ${insight.evidence.length} provenance items · ${shortResourceId(insight.id)}` : "No actionable object selected"}>
              {insight ? `${insight.sourceObjectIds.length} sources · ${insight.evidence.length} provenance · ${shortResourceId(insight.id)}` : "No actionable object selected"}
            </p>
          </div>
          <div className="modalHeaderActions">
            <span className={`plannerMode ${response?.mode === "mcp_read_only" ? "live" : ""}`} title={gateStatus}>
              {gateStatus}
            </span>
            <button
              className="secondaryButton compactButton gateRunButton"
              type="button"
              onClick={onRunResearch}
              disabled={loading || !insight}
              aria-label={loading ? "CivilMCP research is running" : response ? "Run CivilMCP research again" : "Run CivilMCP research"}
              title={loading ? "CivilMCP research is running" : response ? "Run CivilMCP research again" : "Run CivilMCP research"}
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
              <span>{loading ? "Running" : response ? "Run again" : "Run"}</span>
            </button>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close CivilMCP analyst">
            <X size={16} />
          </button>
        </header>

        <div className="gateBody">
          <section className="gateOverview" aria-label="Selected object research context">
            <div className="gateObjectCard">
              <div className="sectionTitle compactTitle">
                <SearchCheck size={14} />
                <span>Research target</span>
              </div>
              <strong title={insight?.whyNow ?? "No active insight"}>{insight?.whyNow ?? "Select an insight from the object panel first."}</strong>
              <p title={insight?.nextVerificationStep ?? "No verification step available"}>
                {insight?.nextVerificationStep ?? "CivilMCP can only run after a real object and read-model insight are selected."}
              </p>
              <div className="gateObjectMeta">
                <span title={insight?.objectType.replaceAll("_", " ") ?? "No object type"}>{insight?.objectType.replaceAll("_", " ") ?? "No object"}</span>
                <span title={insight?.objectId ?? "No object id"}>{insight ? shortResourceId(insight.objectId) : "No ID"}</span>
                <span title={sourceObjectPreview}>{sourceObjectPreview}</span>
              </div>
            </div>

            <div className="gateStatGrid" aria-label="Research gate counters">
              <span className="gateStat" title="Linked real source objects">
                <b>{insight?.sourceObjectIds.length ?? 0}</b>
                Sources
              </span>
              <span className="gateStat" title="Provenance entries already attached to the insight">
                <b>{insight?.evidence.length ?? 0}</b>
                Prov
              </span>
              <span className="gateStat" title="Expected risk before research-backed action">
                <b>{insight?.riskBefore ?? "-"}</b>
                Before
              </span>
              <span className="gateStat" title="Expected risk after supported action">
                <b>{proposal?.expectedRiskAfter ?? insight?.expectedRiskAfter ?? "-"}</b>
                After
              </span>
            </div>
          </section>

          <section className="gateRunState" aria-label="CivilMCP research status">
            <div className="sectionTitle compactTitle">
              <Activity size={14} />
              <span>Verification path</span>
            </div>
            <div className="gateStepList">
              {gateSteps.map((item) => (
                <div className={`gateStep ${item.state}`} key={item.label} title={`${item.label}: ${item.detail}`}>
                  <span className="gateStepDot" aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <em>{item.state}</em>
                </div>
              ))}
            </div>
          </section>

          {loading ? (
            <section className="mcpLoadingPanel" aria-live="polite">
              <div>
                <strong>CivilMCP is checking cited transport evidence</strong>
                <p>No action record is created until the response contains citation-linked support for the selected object.</p>
              </div>
              <span className="loadingTrace" aria-hidden="true" />
            </section>
          ) : error ? (
            <div className="errorCallout gateMessage">
              <TriangleAlert size={15} />
              <span>{error}</span>
            </div>
          ) : response ? (
            <section className="plannerAnswer gateAnswer">
              <div>
                <span className="miniLabel">{response.mode === "mcp_read_only" ? "Read-only MCP result" : "Fallback result"}</span>
                <strong>{proposal ? proposal.title : "No executable action from the current evidence"}</strong>
                <p>{proposal?.rationale ?? researchFinding?.summary ?? "CivilMCP has not returned cited evidence for this object."}</p>
              </div>
              {proposal ? (
                <div className="riskDeltaStrip">
                  <span title="Before risk">
                    <b>{proposal.riskBefore}</b>
                    Before
                  </span>
                  <span title="Expected after">
                    <b>{proposal.expectedRiskAfter}</b>
                    After
                  </span>
                  <span title="Delta">
                    <b>{proposal.delta}</b>
                    Delta
                  </span>
                  <span title="Confidence">
                    <b>{Math.round(proposal.confidence * 100)}%</b>
                    Conf
                  </span>
                </div>
              ) : null}
              {proposal ? (
                <div className="inlineActionRow">
                  <span>{proposal.caveat}</span>
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={() => onRecord(proposal)}
                    disabled={proposalAlreadyRecorded || !proposalRecordable}
                    title={proposalAlreadyRecorded ? "Action already recorded" : recordDisabledReason || "Acknowledge constraints and record action"}
                    aria-label={proposalAlreadyRecorded ? "Action already recorded" : recordDisabledReason || "Acknowledge and record action"}
                  >
                    <ClipboardCheck size={15} />
                    {proposalAlreadyRecorded ? "Recorded" : "Acknowledge & record"}
                  </button>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="mcpLoadingPanel idle">
              <div>
                <strong>Ready to query CivilMCP</strong>
                <p>Select Run to evaluate this object against cited transport evidence.</p>
              </div>
            </section>
          )}

          {response ? (
            <>
              <section className="researchSection evidenceCompact">
                <div className="sectionTitle">
                  <FileText size={15} />
                  <span>{compactSectionTitle("Evidence split")}</span>
                </div>
                <div className="evidenceSplitGrid">
                  {[liveFinding, baselineFinding, researchFinding, inferenceFinding].filter(Boolean).map((finding) => (
                    <div className="findingRow compactFinding" key={`${finding?.kind}-${finding?.title}`}>
                      <span className="evidenceKind">{finding?.kind.replaceAll("_", " ")}</span>
                      <strong title={finding?.title}>{finding?.title}</strong>
                      <p title={finding?.summary}>{finding?.summary}</p>
                    </div>
                  ))}
                </div>
                <div className="evidenceUseBlock">
                  <div className="sectionTitle compactTitle">
                    <SearchCheck size={14} />
                    <span>{compactSectionTitle("Citation to action map")}</span>
                  </div>
                  {evidenceUseRows.length > 0 ? (
                    <div className="evidenceUseList">
                      {evidenceUseRows.map((item) => (
                        <article className="evidenceUseRow" key={item.evidenceId} title={`${item.researchCitation ?? item.citation} · ${item.sectionTitle}`}>
                          <div className="evidenceUseSource">
                            <span>Citation</span>
                            <strong title={item.researchCitation ?? item.citation}>{shortRecordTitle(item.researchCitation ?? item.citation)}</strong>
                            <small>{item.sectionTitle}</small>
                            <em className={`evidenceStrength ${item.evidenceStrength}`}>
                              {item.evidenceStrength.replaceAll("_", " ")}
                            </em>
                          </div>
                          <div className="evidenceUseText">
                            <div className="evidenceUseFact">
                              <b>Evidence</b>
                              <p>{item.excerpt}</p>
                            </div>
                            <div className="evidenceUseFact">
                              <b>Applies</b>
                              <p>{item.objectLink}</p>
                            </div>
                            <div className="evidenceUseFact">
                              <b>Check</b>
                              <p>{item.operatorCheck}</p>
                            </div>
                            <div className="evidenceUseFact">
                              <b>Action</b>
                              <p>{item.actionImplication}</p>
                            </div>
                            {item.matchedTerms.length > 0 ? (
                              <div className="matchedTerms" aria-label="Matched evidence terms">
                                {item.matchedTerms.map((term) => (
                                  <span key={`${item.evidenceId}-${term}`}>{term}</span>
                                ))}
                              </div>
                            ) : null}
                            <div className="evidenceSourceSplit">
                              <small>Related operational sources: {(item.operationalSources ?? []).join(" · ") || "Selected object"}</small>
                              <small>Research source: {item.source}</small>
                            </div>
                            <small>{item.caveat}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="emptyBrief compactEmpty">CivilMCP did not return direct cited evidence that can be mapped into an action.</div>
                  )}
                </div>
              </section>

              <section className="researchSection sequenceSection">
                <div className="sectionTitle">
                  <GitCompareArrows size={15} />
                  <span>{compactSectionTitle("Action sequence")}</span>
                </div>
                <div className="sequenceList">
                  {sequence.map((item, index) => (
                    <div className="sequenceStep" key={item.label}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {!proposal ? (
                  <div className="emptyBrief">No action can be recorded because CivilMCP did not return direct cited evidence.</div>
                ) : null}
              </section>

              <div className="limitations">
                {response.limitations.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function TransportOpsDashboard() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [railOverview, setRailOverview] = useState<RailOverview | null>(null);
  const [ontology, setOntology] = useState<OntologyReadModel | null>(null);
  const [insights, setInsights] = useState<SmartCityInsight[]>([]);
  const [layerRegistry, setLayerRegistry] = useState<OpsLayerRegistryResponse | null>(null);
  const [sourceSla, setSourceSla] = useState<OpsSourceSlaResponse | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedRailCaseId, setSelectedRailCaseId] = useState<string | null>(null);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [railLoading, setRailLoading] = useState(true);
  const [analystLoading, setAnalystLoading] = useState(false);
  const [analystBrief, setAnalystBrief] = useState<AnalystBrief | null>(null);
  const [analystOpen, setAnalystOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchWorkflow, setResearchWorkflow] = useState<ResearchWorkflowResponse | null>(null);
  const [railResearchOpen, setRailResearchOpen] = useState(false);
  const [railResearchLoading, setRailResearchLoading] = useState(false);
  const [railWorkflow, setRailWorkflow] = useState<RailResearchWorkflowResponse | null>(null);
  const [railRecords, setRailRecords] = useState<RailActionRecord[]>([]);
  const [researchGateOpen, setResearchGateOpen] = useState(false);
  const [researchGateLoading, setResearchGateLoading] = useState(false);
  const [researchGateResponse, setResearchGateResponse] = useState<ResearchGateResponse | null>(null);
  const [researchGateError, setResearchGateError] = useState<string | null>(null);
  const [actionRecords, setActionRecords] = useState<SmartCityActionRecord[]>([]);
  const [executionLog, setExecutionLog] = useState<ActionProposal[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey>("overview");
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [openPopover, setOpenPopover] = useState<PopoverKey>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [mapCommandLog, setMapCommandLog] = useState<OpsMapCommandEnvelope[]>([]);
  const [mapCommandState, setMapCommandState] = useState<OpsMapCommandState>({ layers: DEFAULT_LAYERS, styleOverrides: {} });

  const selectedHotspot = useMemo(
    () => overview?.hotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? null,
    [overview, selectedHotspotId],
  );

  const selectedRailCase = useMemo(
    () => railOverview?.cases.find((railCase) => railCase.id === selectedRailCaseId) ?? null,
    [railOverview, selectedRailCaseId],
  );

  const selectedInsight = useMemo(
    () => insights.find((insight) => insight.id === selectedInsightId) ?? null,
    [insights, selectedInsightId],
  );

  const selectedInsightObject = useMemo(
    () => (selectedInsight && ontology ? ontology.objects.find((object) => object.id === selectedInsight.objectId) ?? null : null),
    [ontology, selectedInsight],
  );

  const relatedEvents = useMemo(() => {
    if (!overview || !selectedHotspot) return [];
    const selectedEvent = overview.events.find((event) => event.id === selectedEventId);
    const corridor = selectedHotspot.corridor.toLowerCase();
    const matches = overview.events
      .filter((event) => {
        const haystack = `${event.title} ${event.description} ${String(event.attributes.corridor ?? "")}`.toLowerCase();
        return haystack.includes(corridor.split(" ")[0].toLowerCase()) || event.id === selectedEventId;
      })
      .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
    return selectedEvent && !matches.some((event) => event.id === selectedEvent.id) ? [selectedEvent, ...matches].slice(0, 4) : matches.slice(0, 4);
  }, [overview, selectedEventId, selectedHotspot]);

  const relatedRailEvents = useMemo(() => {
    if (!railOverview || !selectedRailCase) return [];
    const ids = new Set(selectedRailCase.relatedEventIds);
    return railOverview.events
      .filter((event) => ids.has(event.id) || String(event.attributes.crossingId ?? "") === selectedRailCase.crossingAssetId)
      .slice(0, 5);
  }, [railOverview, selectedRailCase]);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const response = await opsFetch("/api/ops/overview", { cache: "no-store" });
    const data = (await response.json()) as OpsOverview;
    setOverview(data);
    if (!silent) setLoading(false);
  }, []);

  const loadRailOverview = useCallback(async (silent = false) => {
    if (!silent) setRailLoading(true);
    const response = await opsFetch("/api/ops/rail/overview", { cache: "no-store" });
    const data = (await response.json()) as RailOverview;
    setRailOverview(data);
    if (!silent) setRailLoading(false);
  }, []);

  const loadOntologyInsights = useCallback(async () => {
    const [ontologyResponse, insightsResponse, recordsResponse, layerRegistryResponse, sourceSlaResponse, commandLogResponse] = await Promise.all([
      opsFetch("/api/ops/ontology/objects", { cache: "no-store" }),
      opsFetch("/api/ops/insights?domain=transport&limit=8", { cache: "no-store" }),
      opsFetch("/api/ops/actions/log", { cache: "no-store" }),
      opsFetch("/api/ops/layers/registry", { cache: "no-store" }),
      opsFetch("/api/ops/sources/sla", { cache: "no-store" }),
      opsFetch("/api/ops/commands/log?limit=12", { cache: "no-store" }),
    ]);
    const ontologyData = (await ontologyResponse.json()) as OntologyReadModel;
    const insightsData = (await insightsResponse.json()) as { insights?: SmartCityInsight[] };
    const recordData = (await recordsResponse.json()) as { records?: SmartCityActionRecord[] };
    const registryData = (await layerRegistryResponse.json()) as OpsLayerRegistryResponse;
    const sourceSlaData = (await sourceSlaResponse.json()) as OpsSourceSlaResponse;
    const commandLogData = (await commandLogResponse.json()) as { commands?: OpsMapCommandEnvelope[] };
    const nextInsights = insightsData.insights ?? [];
    setOntology(ontologyData);
    setInsights(nextInsights);
    setLayerRegistry(registryData);
    setSourceSla(Array.isArray(sourceSlaData.sources) ? sourceSlaData : null);
    setSelectedInsightId((current) => {
      if (current && nextInsights.some((insight) => insight.id === current)) return current;
      return nextInsights[0]?.id ?? null;
    });
    setActionRecords(recordData.records ?? []);
    setMapCommandLog(Array.isArray(commandLogData.commands) ? commandLogData.commands : []);
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadRailOverview();
    void loadOntologyInsights();
  }, [loadOverview, loadRailOverview, loadOntologyInsights]);

  useEffect(() => {
    const refreshVisibleReadModel = () => {
      if (document.visibilityState !== "visible") return;
      void loadOverview(true);
      void loadRailOverview(true);
      void loadOntologyInsights();
    };

    const interval = window.setInterval(refreshVisibleReadModel, REALTIME_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshVisibleReadModel);
    document.addEventListener("visibilitychange", refreshVisibleReadModel);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisibleReadModel);
      document.removeEventListener("visibilitychange", refreshVisibleReadModel);
    };
  }, [loadOverview, loadRailOverview, loadOntologyInsights]);

  useEffect(() => {
    if (!overview || !mapNode.current || mapRef.current) return;
    mapRef.current = initializeMap(
      mapNode.current,
      overview,
      (id) => {
        setSelectedHotspotId(id);
        setAnalystBrief(null);
        setResearchWorkflow(null);
      },
      (id) => setSelectedEventId(id),
      (id) => {
        setSelectedRailCaseId(id);
        setRailWorkflow(null);
      },
    );
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [overview]);

  useEffect(() => {
    if (!overview || !mapRef.current) return;
    bindMapData(mapRef.current, overview, layers);
  }, [overview, layers]);

  useEffect(() => {
    if (!mapRef.current) return;
    bindRailData(mapRef.current, railOverview, layers);
  }, [railOverview, layers]);

  useEffect(() => {
    if (!selectedHotspot || !mapRef.current) return;
    mapRef.current.flyTo({
      center: selectedHotspot.geometry.coordinates,
      zoom: Math.max(mapRef.current.getZoom(), 12.2),
      duration: 750,
    });
  }, [selectedHotspot]);

  useEffect(() => {
    if (!selectedRailCase || !mapRef.current || !layers.rail) return;
    mapRef.current.flyTo({
      center: selectedRailCase.geometry.coordinates,
      zoom: Math.max(mapRef.current.getZoom(), 12.5),
      duration: 650,
    });
  }, [layers.rail, selectedRailCase]);

  useEffect(() => {
    if (!selectedHotspot || insights.length === 0) return;
    const ontologyId = `hotspot:${selectedHotspot.id}`;
    const matchingInsight = insights.find((insight) => insight.objectId === ontologyId || insight.sourceObjectIds.includes(ontologyId));
    if (matchingInsight) setSelectedInsightId(matchingInsight.id);
  }, [insights, selectedHotspot]);

  useEffect(() => {
    if (!selectedRailCase || insights.length === 0) return;
    const ontologyId = `hotspot:${selectedRailCase.id}`;
    const matchingInsight = insights.find((insight) => insight.objectId === ontologyId || insight.sourceObjectIds.includes(ontologyId));
    if (matchingInsight) setSelectedInsightId(matchingInsight.id);
  }, [insights, selectedRailCase]);

  const runAnalysis = useCallback(async () => {
    if (!selectedHotspot || !overview) return;
    setAnalystLoading(true);
    const response = await opsFetch("/api/ops/analyst", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: `What transport safety actions should operators consider for ${selectedHotspot.name}?`,
        hotspot: selectedHotspot,
        events: relatedEvents,
        sourceHealth: overview.sourceHealth,
      }),
    });
    setAnalystBrief((await response.json()) as AnalystBrief);
    setAnalystLoading(false);
  }, [overview, relatedEvents, selectedHotspot]);

  const runResearchWorkflow = useCallback(async () => {
    if (!selectedHotspot || !overview) return;
    setResearchLoading(true);
    const response = await opsFetch("/api/ops/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot: selectedHotspot,
        events: relatedEvents,
      }),
    });
    setResearchWorkflow((await response.json()) as ResearchWorkflowResponse);
    setResearchLoading(false);
  }, [overview, relatedEvents, selectedHotspot]);

  const runRailResearchWorkflow = useCallback(async () => {
    if (!selectedRailCase || !railOverview) return;
    setRailResearchLoading(true);
    const response = await opsFetch("/api/ops/rail/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        railCase: selectedRailCase,
        events: relatedRailEvents,
        crossings: railOverview.crossings,
      }),
    });
    setRailWorkflow((await response.json()) as RailResearchWorkflowResponse);
    setRailResearchLoading(false);
  }, [railOverview, relatedRailEvents, selectedRailCase]);

  const executeProposal = useCallback((proposal: ActionProposal) => {
    setExecutionLog((current) => {
      if (current.some((item) => item.id === proposal.id)) return current;
      return [proposal, ...current].slice(0, 5);
    });
  }, []);

  const executeRailProposal = useCallback(
    async (proposal: RailActionProposal) => {
      const researchRunId = railWorkflow?.researchRunId ?? proposal.researchRunId;
      const proposalId = proposal.proposalId ?? proposal.id;
      if (!selectedRailCase || !railWorkflow?.researchPersisted || !researchRunId || !proposalId) return;
      const response = await opsFetch("/api/ops/rail/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researchRunId,
          proposalId,
          acknowledgements: ["read_only_civilmcp_evidence", "local_action_record_only", "expected_delta_not_measured"],
        }),
      });
      const payload = (await response.json()) as { record?: RailActionRecord };
      if (payload.record) {
        setRailRecords((current) => [payload.record as RailActionRecord, ...current].slice(0, 10));
        void opsFetch("/api/ops/actions/log", { cache: "no-store" })
          .then((response) => response.json() as Promise<{ records?: SmartCityActionRecord[] }>)
          .then((data) => setActionRecords(data.records ?? []));
      }
    },
    [railWorkflow?.researchPersisted, railWorkflow?.researchRunId, selectedRailCase],
  );

  const applyMapCommands = useCallback(
    (commands: OpsMapCommand[] | undefined, researchRunId?: string, insightId?: string) => {
      if (!commands?.length) return;
      const envelopes = envelopeMapCommands(commands, { researchRunId });
      let nextState = mapCommandState;
      const applied: OpsMapCommandEnvelope[] = [];
      for (const envelope of envelopes) {
        const result = executeMapCommand(nextState, envelope, ["operator_approved_research_call"]);
        nextState = result.state;
        applied.push(result.envelope);
        if (result.envelope.status !== "applied") continue;
        const command = envelope.command;
        if (command.type === "toggle_layer" && isDashboardLayerKey(command.layerId)) {
          setLayers((current) => ({ ...current, [command.layerId]: command.enabled }));
        }
        if (command.type === "set_view" && mapRef.current) {
          mapRef.current.flyTo({ center: command.center, zoom: command.zoom, duration: 650 });
        }
        if (command.type === "style_layer" && mapRef.current) {
          const paintLayers: Partial<Record<string, string[]>> = {
            incidents: ["ops-event-points"],
            hotspots: ["ops-hotspot-halo", "ops-hotspot-hit"],
            cameras: ["ops-assets"],
            congestion: ["ops-event-points"],
            weather: ["ops-weather-risk"],
            roadworks: ["ops-event-points"],
            osiris: ["ops-event-points", "ops-assets"],
            rail: ["rail-case-halo", "rail-case-hit", "rail-event-points", "rail-crossing-label"],
          };
          for (const layerId of paintLayers[command.layerId] ?? []) {
            if (!mapRef.current.getLayer(layerId)) continue;
            for (const [key, value] of Object.entries(command.style)) {
              try {
                mapRef.current.setPaintProperty(layerId, key, value);
              } catch {
                // Ignore invalid paint keys from non-renderable command suggestions.
              }
            }
          }
        }
        if (command.type === "apply_spatial_filter" && command.bbox && mapRef.current) {
          const [west, south, east, north] = command.bbox;
          mapRef.current.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding: 80, duration: 650 },
          );
        }
        if (command.type === "select_object") {
          const insight = insights.find(
            (item) => item.objectId === command.objectId || item.sourceObjectIds.includes(command.objectId),
          );
          if (insight) setSelectedInsightId(insight.id);
        }
        if (command.type === "open_evidence_panel") {
          setOpenPopover(null);
        }
      }
      setMapCommandState(nextState);
      setMapCommandLog((current) => [...applied, ...current].slice(0, 12));
      void opsFetch("/api/ops/commands/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands,
          researchRunId,
          insightId,
          objectIds: applied.flatMap((item) => item.objectIds ?? []),
          acknowledgements: ["operator_approved_research_call"],
        }),
      })
        .then((response) => response.json() as Promise<{ commands?: OpsMapCommandEnvelope[] }>)
        .then((payload) => {
          if (Array.isArray(payload.commands)) setMapCommandLog((current) => [...payload.commands!, ...current].slice(0, 12));
        })
        .catch(() => undefined);
    },
    [insights, mapCommandState],
  );

  const runOntologyResearchGate = useCallback(async () => {
    if (!selectedInsight) {
      setResearchGateError("Select a real-source actionable object before asking CivilMCP.");
      return;
    }
    setResearchGateLoading(true);
    setResearchGateError(null);
    try {
      const response = await opsFetch("/api/ops/research-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectIds: selectedInsight.sourceObjectIds,
          insight: selectedInsight,
        }),
      });
      const payload = (await response.json()) as ResearchGateResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : `CivilMCP research failed with ${response.status}`);
      }
      setResearchGateResponse(payload as ResearchGateResponse);
      applyMapCommands((payload as ResearchGateResponse).mapCommands, (payload as ResearchGateResponse).researchRunId, (payload as ResearchGateResponse).insightId);
    } catch (error) {
      setResearchGateResponse(null);
      setResearchGateError(error instanceof Error ? error.message : "CivilMCP research failed.");
    } finally {
      setResearchGateLoading(false);
    }
  }, [applyMapCommands, selectedInsight]);

  const recordOntologyProposal = useCallback(
    async (proposal: ResearchGateProposal) => {
      if (!selectedInsight || !researchGateResponse?.researchRunId || !proposal.proposalId) return;
      const response = await opsFetch("/api/ops/actions/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researchRunId: researchGateResponse.researchRunId,
          proposalId: proposal.proposalId,
          acknowledgements: proposal.requiredAcknowledgements ?? [],
        }),
      });
      const payload = (await response.json()) as { record?: SmartCityActionRecord };
      if (payload.record) {
        setActionRecords((current) => [payload.record as SmartCityActionRecord, ...current].slice(0, 20));
      }
    },
    [researchGateResponse?.researchRunId, selectedInsight],
  );

  const selectedEvent = useMemo(() => overview?.events.find((event) => event.id === selectedEventId) ?? null, [overview, selectedEventId]);
  const topStats = useMemo(() => deriveTopStats(overview, railOverview, ontology), [overview, railOverview, ontology]);
  const layerCounts = useMemo(() => {
    const derived = deriveLayerCounts(overview, railOverview);
    if (!layerRegistry) return derived;
    return (Object.keys(derived) as LayerKey[]).reduce<LayerCounts>((acc, key) => {
      acc[key] = layerRegistryMeta(layerRegistry, key)?.count ?? derived[key];
      return acc;
    }, { ...derived });
  }, [layerRegistry, overview, railOverview]);
  const workspaceItems = useMemo(
    () => buildWorkspaceItems({ key: activeWorkspace, overview, railOverview, ontology, insights, actionRecords }),
    [activeWorkspace, actionRecords, insights, ontology, overview, railOverview],
  );
  const commandItems = useMemo(
    () => buildCommandItems({ overview, railOverview, ontology, insights }),
    [insights, ontology, overview, railOverview],
  );
  const selectedDossier = useMemo(
    () =>
      buildDossier({
        selectedEvent,
        selectedHotspot,
        selectedRailCase,
        selectedInsight,
        selectedInsightObject,
      }),
    [selectedEvent, selectedHotspot, selectedRailCase, selectedInsight, selectedInsightObject],
  );

  const refreshAll = useCallback((silent = false) => {
    void loadOverview(silent);
    void loadRailOverview(silent);
    void loadOntologyInsights();
  }, [loadOverview, loadOntologyInsights, loadRailOverview]);

  const togglePopover = useCallback((key: Exclude<PopoverKey, null>) => {
    setOpenPopover((current) => (current === key ? null : key));
  }, []);

  const focusWorkspaceItem = useCallback((item: WorkspaceItem) => {
    if (item.coordinates && mapRef.current) {
      mapRef.current.flyTo({ center: item.coordinates, zoom: Math.max(mapRef.current.getZoom(), 12.4), duration: 650 });
    }
    if (overview?.events.some((event) => event.id === item.id)) setSelectedEventId(item.id);
    if (overview?.hotspots.some((hotspot) => hotspot.id === item.id)) setSelectedHotspotId(item.id);
    if (railOverview?.cases.some((railCase) => railCase.id === item.id)) setSelectedRailCaseId(item.id);
    if (insights.some((insight) => insight.id === item.id)) setSelectedInsightId(item.id);
    setOpenPopover(null);
  }, [insights, overview, railOverview]);

  const selectWorkspace = useCallback((key: WorkspaceKey) => {
    setActiveWorkspace(key);
    setOpenPopover(null);
    if (key === "alerts") setOpenPopover("alerts");
  }, []);

  const selectTool = useCallback((key: ToolKey) => {
    setActiveTool((current) => (current === key ? null : key));
    setOpenPopover(key === "search" ? "command" : "tool");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMapFullscreen(false);
        setOpenPopover(null);
        setActiveTool(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openHotspotResearch = useCallback(() => {
    setResearchOpen(true);
    setResearchWorkflow(null);
    void runResearchWorkflow();
  }, [runResearchWorkflow]);

  const openRailResearch = useCallback(() => {
    setRailResearchOpen(true);
    setRailWorkflow(null);
    void runRailResearchWorkflow();
  }, [runRailResearchWorkflow]);

  const openOntologyResearch = useCallback(() => {
    setResearchGateOpen(true);
    setResearchGateResponse(null);
    setResearchGateError(null);
    void runOntologyResearchGate();
  }, [runOntologyResearchGate]);

  return (
    <main className={`opsShell ${navCollapsed ? "navCollapsed" : ""} ${mapFullscreen ? "mapFullscreen" : ""}`}>
      <TopBar
        stats={topStats}
        loading={loading || railLoading}
        navCollapsed={navCollapsed}
        openPopover={openPopover}
        onRefresh={() => refreshAll()}
        onToggleNav={() => setNavCollapsed((current) => !current)}
        onTogglePopover={togglePopover}
      />
      <div className="workspace">
        <NavRail
          stats={topStats}
          overview={overview}
          railOverview={railOverview}
          ontology={ontology}
          activeWorkspace={activeWorkspace}
          activeTool={activeTool}
          collapsed={navCollapsed}
          onSelectWorkspace={selectWorkspace}
          onSelectTool={selectTool}
        />
        <section className="mapStage">
          <LayerRail
            layers={layers}
            counts={layerCounts}
            registry={layerRegistry}
            collapsed={layersCollapsed}
            setLayers={setLayers}
            onToggleCollapsed={() => setLayersCollapsed((current) => !current)}
          />
          <WorkspaceHeader
            activeWorkspace={activeWorkspace}
            itemCount={workspaceItems.length}
            activeTool={activeTool}
            loading={loading || railLoading}
          />
          {openPopover ? null : <WorkspaceStrip activeWorkspace={activeWorkspace} items={workspaceItems} onFocusItem={focusWorkspaceItem} />}
          <CommandPalette
            open={openPopover === "command"}
            query={searchQuery}
            items={commandItems}
            onQueryChange={setSearchQuery}
            onClose={() => {
              setOpenPopover(null);
              setActiveTool(null);
            }}
            onFocusItem={focusWorkspaceItem}
          />
          <ToolPanel
            activeTool={openPopover === "tool" ? activeTool : null}
            layerCounts={layerCounts}
            bookmarkItems={workspaceItems}
            onClose={() => {
              setOpenPopover(null);
              setActiveTool(null);
            }}
          />
          <div ref={mapNode} className="mapCanvas" aria-label="Bangkok transport safety map" />
          {!overview ? <div className="mapLoading">Loading transport safety picture...</div> : null}
          <MapControlStack mapRef={mapRef} fullscreen={mapFullscreen} onToggleFullscreen={() => setMapFullscreen((current) => !current)} />
          <div className="mapFooter">
            <Timeline overview={overview} />
            <SourceHealthStrip sources={[...(overview?.sourceHealth ?? []), ...(railOverview?.sourceHealth ?? [])]} />
          </div>
        </section>
        <div className="rightColumn">
          <OpsDock
            dossier={selectedDossier}
            overview={overview}
            railOverview={railOverview}
            sourceSla={sourceSla}
            selectedSourceId={selectedSourceId}
            selectedInsight={selectedInsight}
            researchGateResponse={researchGateResponse}
            analystBrief={analystBrief}
            analystLoading={analystLoading}
            actionRecords={actionRecords}
            railRecords={railRecords}
            executionLog={executionLog}
            mapCommandLog={mapCommandLog}
            onAnalyze={runAnalysis}
            onOpenResearch={openHotspotResearch}
            onOpenOntologyResearch={openOntologyResearch}
            onOpenRailResearch={openRailResearch}
            onSelectSource={setSelectedSourceId}
            onDockInteract={() => setOpenPopover(null)}
          />
        </div>
      </div>
      <UtilityDrawer
        openPopover={openPopover}
        stats={topStats}
        overview={overview}
        railOverview={railOverview}
        sourceSla={sourceSla}
        actionRecords={actionRecords}
        onClose={() => setOpenPopover(null)}
      />
      <AnalystPopup
        open={analystOpen}
        brief={analystBrief}
        loading={analystLoading}
        executionLog={executionLog}
        onClose={() => setAnalystOpen(false)}
        onAnalyze={runAnalysis}
        onOpenResearch={() => {
          setAnalystOpen(false);
          openHotspotResearch();
        }}
      />
      <ResearchWorkflowModal
        open={researchOpen}
        hotspot={selectedHotspot}
        relatedEvents={relatedEvents}
        workflow={researchWorkflow}
        loading={researchLoading}
        executionLog={executionLog}
        onClose={() => setResearchOpen(false)}
        onRunResearch={runResearchWorkflow}
        onExecute={executeProposal}
      />
      <RailResearchModal
        open={railResearchOpen}
        railCase={selectedRailCase}
        relatedEvents={relatedRailEvents}
        workflow={railWorkflow}
        loading={railResearchLoading}
        records={railRecords}
        onClose={() => setRailResearchOpen(false)}
        onRunResearch={runRailResearchWorkflow}
        onExecute={executeRailProposal}
      />
      <OntologyResearchGateModal
        open={researchGateOpen}
        insight={selectedInsight}
        response={researchGateResponse}
        loading={researchGateLoading}
        error={researchGateError}
        records={actionRecords}
        onClose={() => setResearchGateOpen(false)}
        onRunResearch={runOntologyResearchGate}
        onRecord={recordOntologyProposal}
      />
    </main>
  );
}
