import React, { useState, useEffect, useRef, ChangeEvent, PointerEvent, CSSProperties } from 'react';
import { Play, Pause, RefreshCw, Upload, Video, Monitor, AppWindow, Settings, Sliders, Activity, Info, AlertCircle, Wifi, WifiOff, Volume2, Lightbulb, Tv, Trash2, Plus, Copy, Check, Eye, Edit3, Search, Grid, Radio, Cpu, Layers, Terminal, ExternalLink, ShieldCheck, Zap, Laptop, ChevronDown, ChevronUp, GripVertical, Maximize2, Minimize2, Bookmark, Save, FolderOpen, Download } from 'lucide-react';
import { WLEDConfig, SyncProtocol, SourceType, EffectType, FrameStats, TargetType, AccentMappingZone, AuxiliaryTarget, NdiStreamInput, DmxUniversePatch, OmtStreamInput, RustEngineStatus, WLEDScenePreset } from './types';
import WLEDEmulator from './components/WLEDEmulator';
import { renderProceduralEffect } from './utils/proceduralEffects';
import { buildNegotiatedOmtUrl, calculateStreamBandwidthStats } from './utils/omtNegotiation';

// ---- Pixel sampling high-fidelity helpers ----
const getPixelColor = (x: number, y: number, width: number, height: number, data: Uint8ClampedArray) => {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const idx = (cy * width + cx) * 4;
  return {
    r: data[idx] !== undefined ? data[idx] : 0,
    g: data[idx + 1] !== undefined ? data[idx + 1] : 0,
    b: data[idx + 2] !== undefined ? data[idx + 2] : 0,
  };
};

const getZoneAverage = (zone: AccentMappingZone, W: number, H: number, data: Uint8ClampedArray) => {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  let startX = 0, endX = W, startY = 0, endY = H;

  switch (zone) {
    case AccentMappingZone.CENTER:
      startX = Math.floor(W / 4);
      endX = Math.ceil((3 * W) / 4);
      startY = Math.floor(H / 4);
      endY = Math.ceil((3 * H) / 4);
      break;
    case AccentMappingZone.TOP:
      startY = 0;
      endY = Math.max(1, Math.floor(H / 6));
      break;
    case AccentMappingZone.BOTTOM:
      startY = Math.max(0, H - Math.max(1, Math.floor(H / 6)));
      endY = H;
      break;
    case AccentMappingZone.LEFT:
      startX = 0;
      endX = Math.max(1, Math.floor(W / 6));
      break;
    case AccentMappingZone.RIGHT:
      startX = Math.max(0, W - Math.max(1, Math.floor(W / 6)));
      endX = W;
      break;
    case AccentMappingZone.WHOLE_AVERAGE:
    default:
      break;
  }

  if (startX >= endX) endX = startX + 1;
  if (startY >= endY) endY = startY + 1;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * W + x) * 4;
      if (idx < data.length) {
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        count++;
      }
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
};

const getCustomMappingColor = (target: AuxiliaryTarget, W: number, H: number, data: Uint8ClampedArray) => {
  const customX = target.customX ?? 50;
  const customY = target.customY ?? 50;
  const type = target.customMappingType ?? 'average';
  const customWidth = target.customWidth ?? 20;
  const customHeight = target.customHeight ?? 20;

  if (type === 'single') {
    const x = Math.max(0, Math.min(W - 1, Math.round((customX / 100) * (W - 1))));
    const y = Math.max(0, Math.min(H - 1, Math.round((customY / 100) * (H - 1))));
    return getPixelColor(x, y, W, H, data);
  } else {
    // Average zone
    const cx = (customX / 100) * W;
    const cy = (customY / 100) * H;
    const bw = (customWidth / 100) * W;
    const bh = (customHeight / 100) * H;

    let startX = Math.max(0, Math.floor(cx - bw / 2));
    let endX = Math.min(W, Math.ceil(cx + bw / 2));
    let startY = Math.max(0, Math.floor(cy - bh / 2));
    let endY = Math.min(H, Math.ceil(cy + bh / 2));

    if (startX >= endX) endX = startX + 1;
    if (startY >= endY) endY = startY + 1;

    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * W + x) * 4;
        if (idx < data.length) {
          rSum += data[idx];
          gSum += data[idx + 1];
          bSum += data[idx + 2];
          count++;
        }
      }
    }

    if (count === 0) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  }
};

// Default Factory Scene Presets
const DEFAULT_PRESETS: WLEDScenePreset[] = [
  {
    id: 'preset-matrix-16x16',
    name: '16x16 Desk Matrix (DDP)',
    description: 'Fast 60 FPS DDP mapping for 256 WS2812B LEDs',
    createdAt: 1700000000000,
    wledConfig: {
      ipAddress: '192.168.1.100',
      port: 4048,
      protocol: SyncProtocol.DDP,
      isMatrix: true,
      width: 16,
      height: 16,
      totalLEDs: 256,
      serpentine: true,
      reverseRows: false,
      vertical: false,
      brightness: 100,
      contrast: 0,
      saturation: 0,
      gamma: 1.0,
      blur: 0,
      fpsLimit: 30,
      timeout: 2,
      universe: 1,
      customMappingEnabled: false,
      customX: 50,
      customY: 50,
      customWidth: 60,
      customHeight: 60,
    },
    auxiliaryTargets: [
      {
        id: 'lightpack-1',
        name: 'Desk Monitor Ambilight',
        type: TargetType.AMBIENT_LIGHTPACK,
        enabled: true,
        ipAddress: '192.168.1.102',
        port: 4048,
        protocol: SyncProtocol.DDP,
        topLedCount: 20,
        rightLedCount: 12,
        bottomLedCount: 20,
        leftLedCount: 12,
        mappedZone: AccentMappingZone.WHOLE_AVERAGE,
        accentLedCount: 1,
        customMappingEnabled: false,
        customMappingType: 'average',
        customX: 50,
        customY: 50,
        customWidth: 20,
        customHeight: 20
      }
    ],
    activeSource: SourceType.E_EFFECTS,
    activeEffect: EffectType.RAINBOW
  },
  {
    id: 'preset-ambient-strip',
    name: 'Ultrawide Ambient Strip (60 LEDs)',
    description: 'Single continuous LED ribbon with edge-sampling ambilight',
    createdAt: 1700000001000,
    wledConfig: {
      ipAddress: '192.168.1.101',
      port: 4048,
      protocol: SyncProtocol.DDP,
      isMatrix: false,
      width: 60,
      height: 1,
      totalLEDs: 60,
      serpentine: false,
      reverseRows: false,
      vertical: false,
      brightness: 90,
      contrast: 10,
      saturation: 20,
      gamma: 1.0,
      blur: 1.5,
      fpsLimit: 60,
      timeout: 2,
      universe: 1,
      customMappingEnabled: false,
      customX: 50,
      customY: 50,
      customWidth: 100,
      customHeight: 20,
    },
    auxiliaryTargets: [],
    activeSource: SourceType.E_EFFECTS,
    activeEffect: EffectType.PERLIN_NOISE
  },
  {
    id: 'preset-stage-dmx',
    name: 'Stage Art-Net 4 Wash Rig',
    description: 'Multi-universe theatrical wash routing over port 6454',
    createdAt: 1700000002000,
    wledConfig: {
      ipAddress: '192.168.1.200',
      port: 6454,
      protocol: SyncProtocol.ARTNET,
      isMatrix: true,
      width: 32,
      height: 16,
      totalLEDs: 512,
      serpentine: true,
      reverseRows: false,
      vertical: false,
      brightness: 100,
      contrast: 0,
      saturation: 15,
      gamma: 1.0,
      blur: 0,
      fpsLimit: 40,
      timeout: 2,
      universe: 0,
      customMappingEnabled: false,
      customX: 50,
      customY: 50,
      customWidth: 80,
      customHeight: 80,
    },
    auxiliaryTargets: [],
    activeSource: SourceType.OMT_STREAM,
    activeEffect: EffectType.RAINBOW
  }
];

const getStoredActiveSetup = (): Partial<WLEDScenePreset> | null => {
  try {
    const raw = localStorage.getItem('wled_last_active_setup');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};

const getStoredPresets = (): WLEDScenePreset[] => {
  try {
    const raw = localStorage.getItem('wled_scenes_library');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_PRESETS;
};

export default function App() {
  const initialSavedSetup = useRef(getStoredActiveSetup());

  // ---- Config States ----
  const [wledConfig, setWledConfig] = useState<WLEDConfig>(() => {
    return initialSavedSetup.current?.wledConfig || {
      ipAddress: '192.168.1.100',
      port: 4048,
      protocol: SyncProtocol.DDP,
      isMatrix: true,
      width: 16,
      height: 16,
      totalLEDs: 256,
      serpentine: true,
      reverseRows: false,
      vertical: false,
      brightness: 100,
      contrast: 0,
      saturation: 0,
      gamma: 1.0,
      blur: 0,
      fpsLimit: 30,
      timeout: 2,
      universe: 1,
      customMappingEnabled: false,
      customX: 50,
      customY: 50,
      customWidth: 60,
      customHeight: 60,
    };
  });

  const [protocolPorts, setProtocolPorts] = useState<{ [key in SyncProtocol]: number }>({
    [SyncProtocol.DDP]: 4048,
    [SyncProtocol.DRGB]: 21324,
    [SyncProtocol.WARLS]: 21324,
    [SyncProtocol.ARTNET]: 6454,
    [SyncProtocol.E131]: 5568,
  });

  // ---- Player & Video States ----
  const [activeSource, setActiveSource] = useState<SourceType>(() => {
    return initialSavedSetup.current?.activeSource || SourceType.E_EFFECTS;
  });
  const [activeEffect, setActiveEffect] = useState<EffectType>(() => {
    return initialSavedSetup.current?.activeEffect || EffectType.RAINBOW;
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [ytQuery, setYtQuery] = useState<string>('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);

  // ---- NDI & Multi-Output State Hooks ----
  const [ndiStreamUrl, setNdiStreamUrl] = useState<string>('http://192.168.1.150:8080/video');
  const [useSimulatedNdi, setUseSimulatedNdi] = useState<boolean>(true);
  const streamImgRef = useRef<HTMLImageElement | null>(null);

  const [ndiInputs, setNdiInputs] = useState<NdiStreamInput[]>([
    {
      id: 'ndi-obs-program',
      name: 'OBS DistroAV - Program Out',
      sourceName: 'GAMING-DESKTOP (OBS - DistroAV Master)',
      ipAddress: '192.168.1.150',
      port: 5961,
      url: 'http://192.168.1.150:8080/video',
      enabled: true,
      resolution: '1920x1080',
      fps: 60,
      status: 'ONLINE'
    },
    {
      id: 'ndi-obs-camera',
      name: 'OBS DistroAV - Live Camera',
      sourceName: 'CAM-PODIUM (OBS - DistroAV Stage Mirror)',
      ipAddress: '192.168.1.152',
      port: 5961,
      url: 'http://192.168.1.152:8080/video',
      enabled: false,
      resolution: '1280x720',
      fps: 30,
      status: 'ONLINE'
    },
    {
      id: 'ndi-cam-hx',
      name: 'Studio Cam HX Output',
      sourceName: 'STUDIO-CAM-A (NDI HX Camera)',
      ipAddress: '192.168.1.112',
      port: 5961,
      url: 'http://192.168.1.112:8554/stream',
      enabled: false,
      resolution: '3840x2160',
      fps: 59,
      status: 'OFFLINE'
    }
  ]);
  const [selectedNdiId, setSelectedNdiId] = useState<string>('ndi-obs-program');
  const [isScanningNdi, setIsScanningNdi] = useState<boolean>(false);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [ndiScriptTab, setNdiScriptTab] = useState<'ndi' | 'mss' | 'opencv' | 'linux-deps' | 'pipewire' | 'gstreamer'>('ndi');
  const [gstreamerPipeline, setGstreamerPipeline] = useState<string>(
    "rtspsrc location=rtsp://127.0.0.1:8554/live_stream latency=0 drop-on-latency=true ! rtph264depay ! h264parse ! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 ! avdec_h264 ! videoconvert ! video/x-raw,format=RGBA ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
  );

  const [showMainPanelOverlay, setShowMainPanelOverlay] = useState<boolean>(true);
  const [showAmbilightOverlay, setShowAmbilightOverlay] = useState<boolean>(true);
  const [showSpotlampsOverlay, setShowSpotlampsOverlay] = useState<boolean>(true);

  // ---- Rust Engine Core State ----
  const [rustEngineStatus, setRustEngineStatus] = useState<RustEngineStatus>({
    connected: false,
    url: 'ws://localhost:8080/ws',
    waylandActive: false,
    omtActive: true,
    latencyUs: 0,
    version: '1.0.0 (Tokio / Rayon)'
  });
  const [showRustModal, setShowRustModal] = useState<boolean>(false);
  const rustWsRef = useRef<WebSocket | null>(null);

  // ---- Open Media Transport (OMT) States ----
  const [omtStreams, setOmtStreams] = useState<OmtStreamInput[]>([
    {
      id: 'omt-vmx-program',
      name: 'vMix Studio / OBS Master Feed',
      sourceName: 'STUDIO-RIG (OMT VMX Program)',
      ipAddress: '192.168.1.150',
      port: 5960,
      url: 'omt://192.168.1.150:5960',
      enabled: true,
      resolution: '1920x1080',
      fps: 60,
      status: 'ONLINE',
      codec: 'VMX (Sub-frame latency <1ms)',
      lossRate: 0.0,
      proxyResolution: '160x120',
      streamProfile: 'proxy',
      requestedFps: 60,
    },
    {
      id: 'omt-cam-stage',
      name: 'Open Camera OMT Stage Feed',
      sourceName: 'STAGE-CAM (Open Camera LAN)',
      ipAddress: '192.168.1.165',
      port: 8080,
      url: 'omt://192.168.1.165:8080',
      enabled: false,
      resolution: '1280x720',
      fps: 60,
      status: 'ONLINE',
      codec: 'VMX 4:2:2',
      lossRate: 0.0,
      proxyResolution: '160x120',
      streamProfile: 'proxy',
      requestedFps: 60,
    }
  ]);
  const [selectedOmtId, setSelectedOmtId] = useState<string>('omt-vmx-program');
  const [isScanningOmt, setIsScanningOmt] = useState<boolean>(false);
  const [omtScanLogs, setOmtScanLogs] = useState<string[]>([]);

  // ---- Linux Wayland PipeWire Capture States ----
  const [waylandFps, setWaylandFps] = useState<number>(60);
  const [waylandDmaBuf, setWaylandDmaBuf] = useState<boolean>(true);
  const [waylandMode, setWaylandMode] = useState<'PORTAL' | 'NATIVE_PIPEWIRE'>('PORTAL');

  // ---- Multi-Universe DMX Patch Matrix ----
  const [dmxPatches, setDmxPatches] = useState<DmxUniversePatch[]>(() => {
    return initialSavedSetup.current?.dmxPatches || [
      {
        id: 'patch-main-ddp',
        name: 'Primary WLED Matrix (DDP)',
        targetIp: '192.168.1.100',
        targetPort: 4048,
        protocol: SyncProtocol.DDP,
        startUniverse: 1,
        universeCount: 1,
        channelsPerUniverse: 512,
        startLedIndex: 0,
        ledCount: 256,
        enabled: true,
      },
      {
        id: 'patch-stage-artnet',
        name: 'Stage Overhead Wash (Art-Net 4)',
        targetIp: '192.168.1.200',
        targetPort: 6454,
        protocol: SyncProtocol.ARTNET,
        startUniverse: 0,
        universeCount: 4,
        channelsPerUniverse: 510,
        startLedIndex: 0,
        ledCount: 680,
        enabled: false,
      },
      {
        id: 'patch-perimeter-sacn',
        name: 'Perimeter LED Strip (sACN E1.31 Multicast)',
        targetIp: '239.255.0.1',
        targetPort: 5568,
        protocol: SyncProtocol.E131,
        startUniverse: 1,
        universeCount: 6,
        channelsPerUniverse: 510,
        startLedIndex: 0,
        ledCount: 1020,
        enabled: false,
      }
    ];
  });
  const [showDmxPatchModal, setShowDmxPatchModal] = useState<boolean>(false);

  // ---- Collapsible & Draggable Divisions State ----
  const [collapsedDivisions, setCollapsedDivisions] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('wled_collapsed_divisions');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleDivision = (id: string) => {
    setCollapsedDivisions(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem('wled_collapsed_divisions', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [col1Order, setCol1Order] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wled_col1_order');
      return saved ? JSON.parse(saved) : ['source', 'hardware', 'aux'];
    } catch {
      return ['source', 'hardware', 'aux'];
    }
  });

  const [col2Order, setCol2Order] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wled_col2_order');
      return saved ? JSON.parse(saved) : ['preview', 'emulator'];
    } catch {
      return ['preview', 'emulator'];
    }
  });

  const [col3Order, setCol3Order] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wled_col3_order');
      return saved ? JSON.parse(saved) : ['calibration', 'telemetry'];
    } catch {
      return ['calibration', 'telemetry'];
    }
  });

  const [draggedDivision, setDraggedDivision] = useState<string | null>(null);
  const [dragOverDivision, setDragOverDivision] = useState<string | null>(null);

  const handleDivDragStart = (e: React.DragEvent, id: string) => {
    setDraggedDivision(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDivDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedDivision && draggedDivision !== id) {
      setDragOverDivision(id);
    }
  };

  const handleDivDrop = (e: React.DragEvent, targetId: string, colNum: 1 | 2 | 3) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedDivision || draggedDivision === targetId) {
      setDraggedDivision(null);
      setDragOverDivision(null);
      return;
    }

    const sourceId = draggedDivision;

    // Filter sourceId from all columns first
    const nextCol1 = col1Order.filter(i => i !== sourceId);
    const nextCol2 = col2Order.filter(i => i !== sourceId);
    const nextCol3 = col3Order.filter(i => i !== sourceId);

    const insertAt = (list: string[], target: string, item: string) => {
      const idx = list.indexOf(target);
      if (idx === -1) return [...list, item];
      return [...list.slice(0, idx), item, ...list.slice(idx)];
    };

    let updatedCol1 = nextCol1;
    let updatedCol2 = nextCol2;
    let updatedCol3 = nextCol3;

    if (colNum === 1) {
      updatedCol1 = insertAt(nextCol1, targetId, sourceId);
    } else if (colNum === 2) {
      updatedCol2 = insertAt(nextCol2, targetId, sourceId);
    } else if (colNum === 3) {
      updatedCol3 = insertAt(nextCol3, targetId, sourceId);
    }

    setCol1Order(updatedCol1);
    setCol2Order(updatedCol2);
    setCol3Order(updatedCol3);

    try {
      localStorage.setItem('wled_col1_order', JSON.stringify(updatedCol1));
      localStorage.setItem('wled_col2_order', JSON.stringify(updatedCol2));
      localStorage.setItem('wled_col3_order', JSON.stringify(updatedCol3));
    } catch {}

    setDraggedDivision(null);
    setDragOverDivision(null);
  };

  const handleSectionDrop = (e: React.DragEvent, colNum: 1 | 2 | 3) => {
    e.preventDefault();
    if (!draggedDivision) return;
    const sourceId = draggedDivision;

    const nextCol1 = col1Order.filter(i => i !== sourceId);
    const nextCol2 = col2Order.filter(i => i !== sourceId);
    const nextCol3 = col3Order.filter(i => i !== sourceId);

    if (colNum === 1 && !nextCol1.includes(sourceId)) nextCol1.push(sourceId);
    if (colNum === 2 && !nextCol2.includes(sourceId)) nextCol2.push(sourceId);
    if (colNum === 3 && !nextCol3.includes(sourceId)) nextCol3.push(sourceId);

    setCol1Order(nextCol1);
    setCol2Order(nextCol2);
    setCol3Order(nextCol3);

    try {
      localStorage.setItem('wled_col1_order', JSON.stringify(nextCol1));
      localStorage.setItem('wled_col2_order', JSON.stringify(nextCol2));
      localStorage.setItem('wled_col3_order', JSON.stringify(nextCol3));
    } catch {}

    setDraggedDivision(null);
    setDragOverDivision(null);
  };

  const resetDivisionLayout = () => {
    const defaultCol1 = ['source', 'hardware', 'aux'];
    const defaultCol2 = ['preview', 'emulator'];
    const defaultCol3 = ['calibration', 'telemetry'];
    setCol1Order(defaultCol1);
    setCol2Order(defaultCol2);
    setCol3Order(defaultCol3);
    setCollapsedDivisions({});
    try {
      localStorage.removeItem('wled_col1_order');
      localStorage.removeItem('wled_col2_order');
      localStorage.removeItem('wled_col3_order');
      localStorage.removeItem('wled_collapsed_divisions');
    } catch {}
  };


  const [auxiliaryTargets, setAuxiliaryTargets] = useState<AuxiliaryTarget[]>(() => {
    return initialSavedSetup.current?.auxiliaryTargets || [
      {
        id: 'lightpack-1',
        name: 'LCD Backlight Ambilight',
        type: TargetType.AMBIENT_LIGHTPACK,
        enabled: false,
        ipAddress: '192.168.1.101',
        port: 5568,
        protocol: SyncProtocol.E131,
        universe: 1,
        topLedCount: 12,
        rightLedCount: 8,
        bottomLedCount: 12,
        leftLedCount: 8,
        mappedZone: AccentMappingZone.WHOLE_AVERAGE,
        accentLedCount: 40
      },
      {
        id: 'accent-bulb-1',
        name: 'Dynamic Desk Spotlight',
        type: TargetType.INDIVIDUAL_ACCENT,
        enabled: false,
        ipAddress: '192.168.1.102',
        port: 4048,
        protocol: SyncProtocol.DDP,
        universe: 0,
        topLedCount: 0,
        rightLedCount: 0,
        bottomLedCount: 0,
        leftLedCount: 0,
        mappedZone: AccentMappingZone.CENTER,
        accentLedCount: 30
      }
    ];
  });
  const [auxPixels, setAuxPixels] = useState<{ [key: string]: Uint8Array }>({});

  // ---- Presets & Scene Library States ----
  const [presets, setPresets] = useState<WLEDScenePreset[]>(getStoredPresets);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [presetToast, setPresetToast] = useState<string | null>(null);
  const [showSavePresetModal, setShowSavePresetModal] = useState<boolean>(false);
  const [showPresetLibraryModal, setShowPresetLibraryModal] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');
  const [rustModalTab, setRustModalTab] = useState<'linux' | 'pi'>('linux');

  // Auto-save setup to localStorage on every change so returning users resume seamlessly
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        const currentSetup: Partial<WLEDScenePreset> = {
          wledConfig,
          auxiliaryTargets,
          activeSource,
          activeEffect,
          dmxPatches,
        };
        localStorage.setItem('wled_last_active_setup', JSON.stringify(currentSetup));
      } catch (e) {
        console.error('Failed to auto-save WLED setup:', e);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [wledConfig, auxiliaryTargets, activeSource, activeEffect, dmxPatches]);

  const loadPreset = (presetId: string) => {
    const target = presets.find(p => p.id === presetId);
    if (!target) return;
    setWledConfig(target.wledConfig);
    setAuxiliaryTargets(target.auxiliaryTargets);
    setActiveSource(target.activeSource);
    setActiveEffect(target.activeEffect);
    if (target.dmxPatches) setDmxPatches(target.dmxPatches);
    setActivePresetId(target.id);

    try {
      localStorage.setItem('wled_last_active_setup', JSON.stringify(target));
    } catch {}

    setPresetToast(`Loaded preset: ${target.name}`);
    setTimeout(() => setPresetToast(null), 3500);
  };

  const saveCurrentAsPreset = (name: string, description: string = '') => {
    if (!name.trim()) return;
    const newPreset: WLEDScenePreset = {
      id: 'preset-' + Date.now(),
      name: name.trim(),
      description: description.trim() || undefined,
      createdAt: Date.now(),
      wledConfig,
      auxiliaryTargets,
      activeSource,
      activeEffect,
      dmxPatches,
    };

    const updated = [newPreset, ...presets];
    setPresets(updated);
    setActivePresetId(newPreset.id);

    try {
      localStorage.setItem('wled_scenes_library', JSON.stringify(updated));
    } catch {}

    setShowSavePresetModal(false);
    setNewPresetName('');
    setNewPresetDesc('');
    setPresetToast(`Saved new scene: ${newPreset.name}`);
    setTimeout(() => setPresetToast(null), 3500);
  };

  const deletePreset = (presetId: string) => {
    const updated = presets.filter(p => p.id !== presetId);
    setPresets(updated);
    if (activePresetId === presetId) setActivePresetId(null);
    try {
      localStorage.setItem('wled_scenes_library', JSON.stringify(updated));
    } catch {}
  };

  const exportPresetsJson = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presets, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `wled-scenes-${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (e) {
      console.error('Failed to export presets', e);
    }
  };

  const importPresetsJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const merged = [...parsed, ...presets.filter(p => !parsed.some(np => np.id === p.id))];
          setPresets(merged);
          localStorage.setItem('wled_scenes_library', JSON.stringify(merged));
          setPresetToast(`Imported ${parsed.length} scene presets`);
          setTimeout(() => setPresetToast(null), 3500);
        }
      } catch (err) {
        console.error('Invalid JSON file format for presets', err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ---- Server Connection States ----
  const [socketStatus, setSocketStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'CONNECTING'>('DISCONNECTED');
  const [stats, setStats] = useState<FrameStats>({
    fps: 0,
    droppedFrames: 0,
    bytesSent: 0,
    packetsSent: 0,
    latencyMs: 0,
  });

  // ---- References ----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const rawPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const [dragState, setDragState] = useState<{
    targetId: string;
    type: 'move' | 'resize';
    startX: number;
    startY: number;
    startCustomX: number;
    startCustomY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  
  // Audio analyzer references
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioBufferRef = useRef<Uint8Array | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);

  // Streaming loops and calculation markers
  const animationFrameId = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(0);
  const statsTracker = useRef({
    frames: 0,
    bytes: 0,
    packets: 0,
    lastSecTime: 0,
  });

  const lastUiUpdateRef = useRef<number>(0);

  const [simulatedPixels, setSimulatedPixels] = useState<Uint8Array>(new Uint8Array(256 * 3));

  // Auto-set standard ports upon protocol changes
  const handleProtocolChange = (protocol: SyncProtocol) => {
    const port = protocolPorts[protocol] !== undefined ? protocolPorts[protocol] : 21324;
    const universe = protocol === SyncProtocol.E131 ? 1 : 0;
    setWledConfig(prev => ({ ...prev, protocol, port, universe }));
  };

  const handlePortChange = (port: number) => {
    setWledConfig(prev => ({ ...prev, port }));
    setProtocolPorts(prev => ({ ...prev, [wledConfig.protocol]: port }));
  };

  // ---- Auxiliary State mutator handlers ----
  const handleToggleAux = (id: string) => {
    setAuxiliaryTargets(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const handleUpdateAux = (id: string, updates: Partial<AuxiliaryTarget>) => {
    setAuxiliaryTargets(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleAddAux = () => {
    const newId = `custom-lamp-${Date.now()}`;
    const newTarget: AuxiliaryTarget = {
      id: newId,
      name: `Accents Spotlight #${auxiliaryTargets.length + 1}`,
      type: TargetType.INDIVIDUAL_ACCENT,
      enabled: true,
      ipAddress: '192.168.1.115',
      port: 4048,
      protocol: SyncProtocol.DDP,
      universe: 0,
      topLedCount: 0,
      rightLedCount: 0,
      bottomLedCount: 0,
      leftLedCount: 0,
      mappedZone: AccentMappingZone.WHOLE_AVERAGE,
      accentLedCount: 30
    };
    setAuxiliaryTargets(prev => [...prev, newTarget]);
  };

  const handleRemoveAux = (id: string) => {
    setAuxiliaryTargets(prev => prev.filter(t => t.id !== id));
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    target: AuxiliaryTarget | 'MAIN_PANEL',
    type: 'move' | 'resize'
  ) => {
    e.preventDefault();
    const container = previewContainerRef.current;
    if (!container) return;

    if (target === 'MAIN_PANEL') {
      setDragState({
        targetId: 'MAIN_PANEL',
        type,
        startX: e.clientX,
        startY: e.clientY,
        startCustomX: wledConfig.customX ?? 50,
        startCustomY: wledConfig.customY ?? 50,
        startWidth: wledConfig.customWidth ?? 60,
        startHeight: wledConfig.customHeight ?? 60,
      });
    } else {
      setDragState({
        targetId: target.id,
        type,
        startX: e.clientX,
        startY: e.clientY,
        startCustomX: target.customX ?? 50,
        startCustomY: target.customY ?? 50,
        startWidth: target.customWidth ?? 20,
        startHeight: target.customHeight ?? 20,
      });
    }
    
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const container = previewContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const deltaX = ((e.clientX - dragState.startX) / rect.width) * 100;
    const deltaY = ((e.clientY - dragState.startY) / rect.height) * 100;

    if (dragState.targetId === 'MAIN_PANEL') {
      if (dragState.type === 'move') {
        const customX = Math.max(0, Math.min(100, Math.round(dragState.startCustomX + deltaX)));
        const customY = Math.max(0, Math.min(100, Math.round(dragState.startCustomY + deltaY)));
        setWledConfig(prev => ({ ...prev, customX, customY }));
      } else if (dragState.type === 'resize') {
        const customWidth = Math.max(2, Math.min(100, Math.round(dragState.startWidth + deltaX * 2)));
        const customHeight = Math.max(2, Math.min(100, Math.round(dragState.startHeight + deltaY * 2)));
        setWledConfig(prev => ({ ...prev, customWidth, customHeight }));
      }
    } else {
      if (dragState.type === 'move') {
        const customX = Math.max(0, Math.min(100, Math.round(dragState.startCustomX + deltaX)));
        const customY = Math.max(0, Math.min(100, Math.round(dragState.startCustomY + deltaY)));
        handleUpdateAux(dragState.targetId, { customX, customY });
      } else if (dragState.type === 'resize') {
        const customWidth = Math.max(2, Math.min(100, Math.round(dragState.startWidth + deltaX * 2)));
        const customHeight = Math.max(2, Math.min(100, Math.round(dragState.startHeight + deltaY * 2)));
        handleUpdateAux(dragState.targetId, { customWidth, customHeight });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}
    setDragState(null);
  };

  // ---- NDI Stream Input state mutators ----
  const handleSelectNdi = (id: string) => {
    setSelectedNdiId(id);
    const target = ndiInputs.find(i => i.id === id);
    if (target) {
      setNdiStreamUrl(target.url);
      setNdiInputs(prev => prev.map(item => ({
        ...item,
        enabled: item.id === id
      })));
      if (!useSimulatedNdi && streamImgRef.current) {
        streamImgRef.current.src = target.url;
      }
    }
  };

  const handleUpdateNdi = (id: string, updates: Partial<NdiStreamInput>) => {
    setNdiInputs(prev => prev.map(item => {
      if (item.id === id) {
        const next = { ...item, ...updates };
        if (id === selectedNdiId && updates.url !== undefined) {
          setNdiStreamUrl(updates.url);
        }
        return next;
      }
      return item;
    }));
  };

  const handleAddNdi = () => {
    const newId = `ndi-input-${Date.now()}`;
    const newSource: NdiStreamInput = {
      id: newId,
      name: `Sourced Feed #${ndiInputs.length + 1}`,
      sourceName: `USER-PC (DistroAV - Source #${ndiInputs.length + 1})`,
      ipAddress: '192.168.1.150',
      port: 5961 + ndiInputs.length,
      url: `http://192.168.1.150:8080/video${ndiInputs.length + 1}`,
      enabled: false,
      resolution: '1920x1080',
      fps: 60,
      status: 'ONLINE'
    };
    setNdiInputs(prev => [...prev, newSource]);
  };

  const handleRemoveNdi = (id: string) => {
    setNdiInputs(prev => {
      const next = prev.filter(item => item.id !== id);
      if (id === selectedNdiId && next.length > 0) {
        // Switch selected NDI to first available
        setSelectedNdiId(next[0].id);
        setNdiStreamUrl(next[0].url);
      }
      return next;
    });
  };

  const handleScanNdiNetwork = () => {
    if (isScanningNdi) return;
    setIsScanningNdi(true);
    setScanLogs([]);

    const logPoints = [
      '⚡ Initializing Multicast mDNS discovery on LAN (Port 5353)...',
      '🔍 Querying pointer records for NDI: _ndi._tcp.local...',
      '📡 Query broadcast routed through gateway local interface...',
      '📥 Received mDNS A-record from 192.168.1.150 (Host: DESKTOP-PC)',
      '✅ DistroAV Program stream resolved [DESKTOP-GAMING (DistroAV - Program)]',
      '✅ DistroAV Preview stream resolved [DESKTOP-GAMING (DistroAV - Preview)]',
      '📥 Received mDNS A-record from 192.168.1.152 (Host: CAM-PODIUM)',
      '✅ DistroAV Camera resolved [CAM-PODIUM (DistroAV Stage Mirror)]',
      '🎉 NDI discovery completed. Found 3 sources active on local subnet!'
    ];

    logPoints.forEach((msg, idx) => {
      setTimeout(() => {
        setScanLogs(prev => [...prev, msg]);
        if (idx === logPoints.length - 1) {
          setIsScanningNdi(false);
          // Set all existing preset sources to ONLINE status during simulation
          setNdiInputs(prev => prev.map(item => {
            if (item.id === 'ndi-obs-program' || item.id === 'ndi-obs-camera') {
              return { ...item, status: 'ONLINE' };
            }
            return item;
          }));
        }
      }, (idx + 1) * 600);
    });
  };

  // ---- OMT Stream Handlers ----
  const handleSelectOmt = (id: string) => {
    setSelectedOmtId(id);
    setOmtStreams(prev => prev.map(s => ({ ...s, enabled: s.id === id })));
  };

  const handleUpdateOmt = (id: string, updates: Partial<OmtStreamInput>) => {
    setOmtStreams(prev => prev.map(s => (s.id === id ? { ...s, ...updates } : s)));
  };

  const handleScanOmtNetwork = () => {
    if (isScanningOmt) return;
    setIsScanningOmt(true);
    setOmtScanLogs([]);

    const logPoints = [
      '⚡ Querying DNS-SD Multicast mDNS (_omt._tcp.local) on 224.0.0.251:5353...',
      '🔍 Rust daemon scanning LAN network interfaces for Open Media Transport feeds...',
      '📡 Discovering OMT publishers (VMX ultra-low-latency streams)...',
      '📥 Received PTR response: vMix Studio Master @ 192.168.1.150:5960',
      '✅ Resolved VMX stream format: 1920x1080 @ 60 FPS, Sub-frame latency <1ms',
      '📥 Received PTR response: Open Camera OMT @ 192.168.1.165:8080',
      '✅ Resolved Open Camera feed: 1280x720 @ 60 FPS (YUV422)',
      '🎉 OMT Discovery complete! 2 network streams online.'
    ];

    logPoints.forEach((msg, idx) => {
      setTimeout(() => {
        setOmtScanLogs(prev => [...prev, msg]);
        if (idx === logPoints.length - 1) {
          setIsScanningOmt(false);
          setOmtStreams(prev => prev.map(s => ({ ...s, status: 'ONLINE' })));
        }
      }, (idx + 1) * 450);
    });
  };

  // ---- Rust Engine Auto-Probe Hook ----
  useEffect(() => {
    let active = true;
    const connectRust = () => {
      try {
        const ws = new WebSocket('ws://localhost:8080/ws');
        rustWsRef.current = ws;

        ws.onopen = () => {
          if (!active) return;
          setRustEngineStatus(prev => ({ ...prev, connected: true }));
        };

        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'telemetry' && msg.data) {
              setRustEngineStatus(prev => ({
                ...prev,
                latencyUs: msg.data.render_time_us || 180,
                connected: true,
              }));
              if (msg.data.fps) {
                setStats(s => ({
                  ...s,
                  renderTimeUs: msg.data.render_time_us,
                  latencyMs: Math.max(0.1, Math.round((msg.data.render_time_us || 180) / 100) / 10),
                }));
              }
            }
          } catch {}
        };

        ws.onclose = () => {
          if (!active) return;
          setRustEngineStatus(prev => ({ ...prev, connected: false }));
        };

        ws.onerror = () => {
          if (!active) return;
          setRustEngineStatus(prev => ({ ...prev, connected: false }));
        };
      } catch {
        setRustEngineStatus(prev => ({ ...prev, connected: false }));
      }
    };

    connectRust();
    const interval = setInterval(() => {
      if (!rustWsRef.current || rustWsRef.current.readyState === WebSocket.CLOSED) {
        connectRust();
      }
    }, 6000);

    return () => {
      active = false;
      clearInterval(interval);
      if (rustWsRef.current) rustWsRef.current.close();
    };
  }, []);

  // Sync state changes to Rust Engine if connected
  useEffect(() => {
    if (rustWsRef.current && rustWsRef.current.readyState === WebSocket.OPEN) {
      rustWsRef.current.send(JSON.stringify({
        command: 'update_calibration',
        calibration: {
          brightness: wledConfig.brightness / 100,
          contrast: wledConfig.contrast / 100,
          saturation: wledConfig.saturation / 100,
          gamma: wledConfig.gamma,
        }
      }));
      rustWsRef.current.send(JSON.stringify({
        command: 'update_layout',
        layout: {
          is_matrix: wledConfig.isMatrix,
          width: wledConfig.width,
          height: wledConfig.height,
          total_leds: wledConfig.totalLEDs,
          serpentine: wledConfig.serpentine,
          reverse_rows: wledConfig.reverseRows,
          vertical: wledConfig.vertical,
        }
      }));
    }
  }, [wledConfig.brightness, wledConfig.contrast, wledConfig.saturation, wledConfig.gamma, wledConfig.isMatrix, wledConfig.width, wledConfig.height, wledConfig.serpentine, wledConfig.reverseRows, wledConfig.vertical]);

  // ---- WebSocket Connection Handler ----
  useEffect(() => {
    if (isStreaming) {
      setSocketStatus('CONNECTING');
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${window.location.host}/api/video-sync`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setSocketStatus('CONNECTED');
        console.log('WLED Video Sync WebSocket active');
      };

      ws.onclose = () => {
        setSocketStatus('DISCONNECTED');
        setIsStreaming(false);
      };

      ws.onerror = (err) => {
        console.error('WebSocket connection failure:', err);
        setSocketStatus('DISCONNECTED');
        setIsStreaming(false);
      };

      return () => {
        ws.close();
      };
    } else {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setSocketStatus('DISCONNECTED');
    }
  }, [isStreaming]);

  // Handle total LED calculations when grid dims change
  useEffect(() => {
    const total = wledConfig.isMatrix 
      ? wledConfig.width * wledConfig.height
      : wledConfig.totalLEDs;
    setSimulatedPixels(new Uint8Array(total * 3));
  }, [wledConfig.isMatrix, wledConfig.width, wledConfig.height, wledConfig.totalLEDs]);

  // Clean source elements on type update
  const stopExistingMedia = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      if (videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      videoRef.current.removeAttribute('src');
      try {
        videoRef.current.load();
      } catch (err) {
        // Safe catch
      }
    }
    setIsPlaying(false);
    setCameraError(null);
    setScreenShareError(null);
  };

  useEffect(() => {
    stopExistingMedia();
  }, [activeSource]);

  // ---- Audio Capture Setup ----
  const enableMicrophone = async () => {
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      
      if (!navigator.mediaDevices) {
        throw new Error("Audio capture (microphone input) is blocked. Web browser security policies require a secure context (HTTPS or localhost) to use audio/video capture devices. If you are accessing this computer's IP address remotely (e.g. 192.168.1.x), please open it from localhost directly or configure HTTPS.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // Low bounds for low frequency grid bands
      
      const micSource = audioCtx.createMediaStreamSource(stream);
      micSource.connect(analyser);
      
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      microphoneRef.current = micSource;
      audioBufferRef.current = new Uint8Array(analyser.frequencyBinCount);
      setIsMicEnabled(true);
    } catch (err) {
      console.warn('Microphone permission denied / not available:', err);
      setIsMicEnabled(false);
    }
  };

  // ---- Play Video Safely ----
  const playVideoSafe = () => {
    if (!videoRef.current) return;
    videoRef.current.play()
      .then(() => {
        setIsPlaying(true);
      })
      .catch((err) => {
        // Discard AbortError since it's a completely expected part of switching sources or pausing
        if (err.name !== 'AbortError') {
          console.error('Failed to play media stream:', err);
        }
      });
  };

  // ---- Video File Picker ----
  const handleVideoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      stopExistingMedia();
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      
      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.loop = true;
        playVideoSafe();
      }
    }
  };

  // ---- Webcam Selector ----
  const startCameraStream = async () => {
    setCameraError(null);
    try {
      stopExistingMedia();
      if (!navigator.mediaDevices) {
        throw new Error("Webcam access is blocked. Web browser security policies require a secure context (HTTPS or localhost) to use audio/video capture devices. If you are accessing this computer's IP address remotely (e.g. 192.168.1.x), please open the app using 'localhost' directly on the host machine or configure an HTTPS reverse proxy.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        playVideoSafe();
      }
    } catch (err: any) {
      console.error('Webcam access error:', err);
      setCameraError(err?.message || String(err));
    }
  };

  // ---- Screen Shared Grabber ----
  const startScreenCapture = async () => {
    setScreenShareError(null);
    try {
      stopExistingMedia();
      if (!navigator.mediaDevices) {
        throw new Error("Screen capture is blocked. Web browser security policies require a secure context (HTTPS or localhost) to use display capture. If you are accessing this computer's IP address remotely (e.g. 192.168.1.x), please open the app using 'localhost' directly on the host machine or configure an HTTPS reverse proxy.");
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        playVideoSafe();
      }
      // Listen for screensharing block end
      stream.getVideoTracks()[0].onended = () => {
        setIsPlaying(false);
      };
    } catch (err: any) {
      console.error('Screen capture rejected:', err);
      setScreenShareError(err?.message || String(err));
    }
  };

  // ---- Linux Wayland ScreenCast Grabber (xdg-desktop-portal / PipeWire) ----
  const startWaylandScreenCapture = async () => {
    setScreenShareError(null);
    try {
      stopExistingMedia();
      if (!navigator.mediaDevices) {
        throw new Error("Wayland screen capture requires HTTPS or localhost.");
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: waylandFps, max: 240 }
        },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        playVideoSafe();
      }
      stream.getVideoTracks()[0].onended = () => {
        setIsPlaying(false);
      };
    } catch (err: any) {
      console.error('Wayland Portal ScreenCast error:', err);
      setScreenShareError(err?.message || String(err));
    }
  };

  // Play / Pause buttons
  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      playVideoSafe();
    }
  };

  // ---- Central Processing Render Frame Tick Hook ----
  useEffect(() => {
    const processFrame = (timestamp: number) => {
      // Establish target frames intervals matching limit limits
      const interval = 1000 / wledConfig.fpsLimit;
      const elapsed = timestamp - lastFrameTime.current;

      if (elapsed >= interval) {
        lastFrameTime.current = timestamp - (elapsed % interval);

        const procCanvas = processingCanvasRef.current;
        const prevCanvas = previewCanvasRef.current;
        const rawCanvas = rawPreviewCanvasRef.current;
        if (!procCanvas || !prevCanvas) {
          animationFrameId.current = requestAnimationFrame(processFrame);
          return;
        }

        const ctx = procCanvas.getContext('2d', { willReadFrequently: true });
        const prevCtx = prevCanvas.getContext('2d');
        const rawCtx = rawCanvas?.getContext('2d');
        if (!ctx || !prevCtx) {
          animationFrameId.current = requestAnimationFrame(processFrame);
          return;
        }

        // Establish core grids sizing boundaries
        const W = wledConfig.isMatrix ? wledConfig.width : wledConfig.totalLEDs;
        const H = wledConfig.isMatrix ? wledConfig.height : 1;

        // Create a temporary offscreen canvas for high-fidelity uncropped frame rendering
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 320;
        tempCanvas.height = 320;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          if (activeSource === SourceType.E_EFFECTS) {
            if (activeEffect === EffectType.AUDIO_SPECTRUM && analyserRef.current && audioBufferRef.current) {
              analyserRef.current.getByteFrequencyData(audioBufferRef.current);
            }
            renderProceduralEffect(tempCtx, 320, 320, activeEffect, timestamp / 1000, audioBufferRef.current || undefined);
          } else if (activeSource === SourceType.NDI_IP_STREAM) {
            if (useSimulatedNdi) {
              tempCtx.fillStyle = '#08080a';
              tempCtx.fillRect(0, 0, 320, 320);
              const barW = Math.max(1, 320 / 6);
              const colors = ['#ffffff', '#eab308', '#06b6d4', '#22c55e', '#ec4899', '#ef4444'];
              colors.forEach((col, idx) => {
                tempCtx.fillStyle = col;
                tempCtx.fillRect(idx * barW, 0, barW, Math.round(320 * 0.7));
              });
              const sweepInterval = (timestamp / 1000) % (320 * 2);
              const lineX = sweepInterval > 320 ? 320 * 2 - sweepInterval : sweepInterval;
              tempCtx.strokeStyle = '#f97316';
              tempCtx.lineWidth = 2;
              tempCtx.beginPath();
              tempCtx.moveTo(lineX, 0);
              tempCtx.lineTo(lineX, 320);
              tempCtx.stroke();
              const orbX = (Math.sin(timestamp / 600) + 1) * 0.5 * 320;
              const orbY = (Math.cos(timestamp / 400) + 1) * 0.5 * 320;
              tempCtx.fillStyle = '#3b82f6';
              tempCtx.beginPath();
              tempCtx.arc(orbX, orbY, Math.max(4, 320 / 7), 0, Math.PI * 2);
              tempCtx.fill();
            } else if (streamImgRef.current && streamImgRef.current.complete && streamImgRef.current.naturalWidth > 0) {
              try {
                tempCtx.drawImage(streamImgRef.current, 0, 0, 320, 320);
              } catch (err) {
                tempCtx.fillStyle = '#18181b';
                tempCtx.fillRect(0, 0, 320, 320);
              }
            } else {
              tempCtx.fillStyle = '#18181b';
              tempCtx.fillRect(0, 0, 320, 320);
            }
          } else if (activeSource === SourceType.WAYLAND_CAPTURE) {
            if (videoRef.current && isPlaying && (videoRef.current.readyState >= 1) && videoRef.current.videoWidth > 0) {
              try {
                tempCtx.drawImage(videoRef.current, 0, 0, 320, 320);
              } catch {
                tempCtx.fillStyle = '#0a0e17';
                tempCtx.fillRect(0, 0, 320, 320);
              }
            } else {
              // Simulated Wayland PipeWire DMA-BUF frame with dynamic test pattern
              tempCtx.fillStyle = '#070a12';
              tempCtx.fillRect(0, 0, 320, 320);
              const gridCols = ['#0284c7', '#06b6d4', '#10b981', '#f59e0b', '#ec4899'];
              gridCols.forEach((col, idx) => {
                const barWidth = 320 / gridCols.length;
                tempCtx.fillStyle = col;
                tempCtx.fillRect(idx * barWidth, 40, barWidth, 140);
              });
              const sweep = (timestamp / 3) % 320;
              tempCtx.fillStyle = '#ffffff';
              tempCtx.fillRect(sweep, 40, 3, 140);
              tempCtx.fillStyle = '#0f172a';
              tempCtx.fillRect(0, 180, 320, 140);
              tempCtx.fillStyle = '#38bdf8';
              tempCtx.font = 'bold 12px monospace';
              tempCtx.fillText('🐧 LINUX WAYLAND PIPEWIRE', 45, 230);
              tempCtx.fillStyle = '#94a3b8';
              tempCtx.font = '10px monospace';
              tempCtx.fillText('DMA-BUF Zero-Copy Active (<1ms)', 45, 255);
              tempCtx.fillStyle = '#22c55e';
              tempCtx.beginPath();
              tempCtx.arc(32, 226, 5, 0, Math.PI * 2);
              tempCtx.fill();
            }
          } else if (activeSource === SourceType.OMT_STREAM) {
            // Open Media Transport (OMT) VMX ultra-low latency frame renderer
            tempCtx.fillStyle = '#040711';
            tempCtx.fillRect(0, 0, 320, 320);
            const omtCols = ['#ffffff', '#facc15', '#06b6d4', '#22c55e', '#ec4899', '#ef4444', '#3b82f6'];
            const barW = 320 / omtCols.length;
            omtCols.forEach((col, idx) => {
              tempCtx.fillStyle = col;
              tempCtx.fillRect(idx * barW, 20, barW, 160);
            });
            // OMT VMX Sub-frame sweep line
            const sweep = (timestamp / 2) % 320;
            tempCtx.strokeStyle = '#10b981';
            tempCtx.lineWidth = 2;
            tempCtx.beginPath();
            tempCtx.moveTo(sweep, 20);
            tempCtx.lineTo(sweep, 180);
            tempCtx.stroke();
            // Bottom HUD
            tempCtx.fillStyle = '#090d16';
            tempCtx.fillRect(0, 180, 320, 140);
            tempCtx.fillStyle = '#10b981';
            tempCtx.font = 'bold 12px monospace';
            tempCtx.fillText('📡 OPEN MEDIA TRANSPORT (OMT)', 35, 225);
            tempCtx.fillStyle = '#64748b';
            tempCtx.font = '10px monospace';
            tempCtx.fillText('VMX Codec 4:2:2 | Sub-Frame Latency', 35, 250);
            tempCtx.fillStyle = '#e2e8f0';
            tempCtx.font = '9px monospace';
            tempCtx.fillText('mDNS Discovered: _omt._tcp.local', 35, 275);
          } else if (videoRef.current && isPlaying && (videoRef.current.readyState >= 1) && videoRef.current.videoWidth > 0) {
            try {
              tempCtx.drawImage(videoRef.current, 0, 0, 320, 320);
            } catch (err) {
              tempCtx.fillStyle = '#18181b';
              tempCtx.fillRect(0, 0, 320, 320);
            }
          } else {
            tempCtx.fillStyle = '#18181b';
            tempCtx.fillRect(0, 0, 320, 320);
          }
        }

        const tempColors = tempCtx ? tempCtx.getImageData(0, 0, 320, 320).data : new Uint8ClampedArray(320 * 320 * 4);

        if (procCanvas.width !== W || procCanvas.height !== H) {
          procCanvas.width = W;
          procCanvas.height = H;
        }

        // Apply HTML5 hardware acceleration picture controls (contrast, brightness, blur, saturate)
        const filterStr = `brightness(${wledConfig.brightness}%) contrast(${100 + wledConfig.contrast}%) saturate(${100 + wledConfig.saturation}%) blur(${wledConfig.blur}px)`;
        ctx.filter = filterStr;

        // Draw cropped or full uncropped region onto the mini processing canvas
        if (wledConfig.customMappingEnabled) {
          const cx = wledConfig.customX ?? 50;
          const cy = wledConfig.customY ?? 50;
          const cw = wledConfig.customWidth ?? 60;
          const ch = wledConfig.customHeight ?? 60;

          const leftPct = cx - cw / 2;
          const topPct = cy - ch / 2;

          const sX = (leftPct / 100) * 320;
          const sY = (topPct / 100) * 320;
          const sW = (cw / 100) * 320;
          const sH = (ch / 100) * 320;

          ctx.drawImage(tempCanvas, sX, sY, sW, sH, 0, 0, W, H);
        } else {
          ctx.drawImage(tempCanvas, 0, 0, 320, 320, 0, 0, W, H);
        }

        // 2. Extract layout dimensions
        const imgData = ctx.getImageData(0, 0, W, H);
        const data = imgData.data;

        // 3. Render raw preview scales
        if (rawCanvas && rawCtx) {
          if (rawCanvas.width !== W || rawCanvas.height !== H) {
            rawCanvas.width = W;
            rawCanvas.height = H;
          }
          rawCtx.putImageData(imgData, 0, 0);
        }

        // Render bigger preview canvas for the UI (Always 320x320 to match uncropped master)
        prevCanvas.width = 320;
        prevCanvas.height = 320;
        prevCtx.imageSmoothingEnabled = false;
        prevCtx.drawImage(tempCanvas, 0, 0, 320, 320);

        // Draw Main WLED Panel mapping zone visualizer overlay on canvas
        if (wledConfig.customMappingEnabled && showMainPanelOverlay) {
          const pW = prevCanvas.width;
          const pH = prevCanvas.height;

          const cx = ((wledConfig.customX ?? 50) / 100) * pW;
          const cy = ((wledConfig.customY ?? 50) / 100) * pH;
          const bw = ((wledConfig.customWidth ?? 60) / 100) * pW;
          const bh = ((wledConfig.customHeight ?? 60) / 100) * pH;

          const overlayX = Math.max(0, cx - bw / 2);
          const overlayY = Math.max(0, cy - bh / 2);
          const overlayW = Math.min(pW - overlayX, bw);
          const overlayH = Math.min(pH - overlayY, bh);

          prevCtx.save();
          prevCtx.strokeStyle = '#f97316'; // Orange for main panel crop
          prevCtx.lineWidth = 1.5;
          prevCtx.setLineDash([3, 3]);
          prevCtx.strokeRect(overlayX, overlayY, overlayW, overlayH);
          
          prevCtx.fillStyle = 'rgba(249, 115, 22, 0.12)';
          prevCtx.fillRect(overlayX, overlayY, overlayW, overlayH);

          prevCtx.font = 'bold 8px system-ui, sans-serif';
          const labelText = `📺 Main WLED Panel`;
          const textWidth = prevCtx.measureText(labelText).width;
          
          prevCtx.fillStyle = 'rgba(15, 15, 15, 0.85)';
          prevCtx.fillRect(
            Math.max(0, Math.min(pW - textWidth - 6, overlayX)),
            Math.max(0, overlayY - 12),
            textWidth + 6,
            12
          );
          
          prevCtx.fillStyle = '#f97316';
          prevCtx.fillText(
            labelText,
            Math.max(2, Math.min(pW - textWidth - 4, overlayX + 3)),
            Math.max(9, overlayY - 3)
          );
          prevCtx.restore();
        }

        // Draw spotlight/ambient mapping zone visualizer overlays
        auxiliaryTargets.forEach((target) => {
          if (!target.enabled) return;
          
          const pW = prevCanvas.width;
          const pH = prevCanvas.height;

          if (target.type === TargetType.INDIVIDUAL_ACCENT) {
            if (!showSpotlampsOverlay) return;
            let overlayX = 0, overlayY = 0, overlayW = 0, overlayH = 0;
            const isCustom = !!target.customMappingEnabled;

            if (isCustom) {
              const customX = target.customX ?? 50;
              const customY = target.customY ?? 50;
              const type = target.customMappingType ?? 'average';
              const customWidth = target.customWidth ?? 20;
              const customHeight = target.customHeight ?? 20;

              const cx = (customX / 100) * pW;
              const cy = (customY / 100) * pH;

              if (type === 'single') {
                const cellW = pW / W;
                const cellH = pH / H;
                const cellX = Math.max(0, Math.min(W - 1, Math.floor((customX / 100) * W))) * cellW;
                const cellY = Math.max(0, Math.min(H - 1, Math.floor((customY / 100) * H))) * cellH;
                overlayX = cellX;
                overlayY = cellY;
                overlayW = cellW;
                overlayH = cellH;
              } else {
                const bw = (customWidth / 100) * pW;
                const bh = (customHeight / 100) * pH;
                overlayX = Math.max(0, cx - bw / 2);
                overlayY = Math.max(0, cy - bh / 2);
                overlayW = Math.min(pW - overlayX, bw);
                overlayH = Math.min(pH - overlayY, bh);
              }
            } else {
              const zone = target.mappedZone;
              switch (zone) {
                case AccentMappingZone.CENTER:
                  overlayX = pW / 4;
                  overlayY = pH / 4;
                  overlayW = pW / 2;
                  overlayH = pH / 2;
                  break;
                case AccentMappingZone.TOP:
                  overlayX = 0;
                  overlayY = 0;
                  overlayW = pW;
                  overlayH = pH / 6;
                  break;
                case AccentMappingZone.BOTTOM:
                  overlayX = 0;
                  overlayY = pH - pH / 6;
                  overlayW = pW;
                  overlayH = pH / 6;
                  break;
                case AccentMappingZone.LEFT:
                  overlayX = 0;
                  overlayY = 0;
                  overlayW = pW / 6;
                  overlayH = pH;
                  break;
                case AccentMappingZone.RIGHT:
                  overlayX = pW - pW / 6;
                  overlayY = 0;
                  overlayW = pW / 6;
                  overlayH = pH;
                  break;
                case AccentMappingZone.WHOLE_AVERAGE:
                default:
                  overlayX = 0;
                  overlayY = 0;
                  overlayW = pW;
                  overlayH = pH;
                  break;
              }
            }

            prevCtx.save();
            prevCtx.strokeStyle = isCustom ? '#10b981' : '#f97316'; // Green for custom, Orange for zone
            prevCtx.lineWidth = 1.5;
            prevCtx.setLineDash([3, 3]);
            prevCtx.strokeRect(overlayX, overlayY, overlayW, overlayH);
            
            prevCtx.fillStyle = isCustom ? 'rgba(16, 185, 129, 0.12)' : 'rgba(249, 115, 22, 0.12)';
            prevCtx.fillRect(overlayX, overlayY, overlayW, overlayH);

            prevCtx.font = 'bold 8px system-ui, sans-serif';
            const labelText = `${target.name}`;
            const textWidth = prevCtx.measureText(labelText).width;
            
            prevCtx.fillStyle = 'rgba(15, 15, 15, 0.85)';
            prevCtx.fillRect(
              Math.max(0, Math.min(pW - textWidth - 6, overlayX)),
              Math.max(0, overlayY - 12),
              textWidth + 6,
              12
            );
            
            prevCtx.fillStyle = isCustom ? '#34d399' : '#f97316';
            prevCtx.fillText(
              labelText,
              Math.max(2, Math.min(pW - textWidth - 4, overlayX + 3)),
              Math.max(9, overlayY - 3)
            );
            prevCtx.restore();
          } else if (target.type === TargetType.AMBIENT_LIGHTPACK) {
            if (!showAmbilightOverlay) return;
            prevCtx.save();
            prevCtx.strokeStyle = '#38bdf8'; // Sky blue for ambilight bounds
            prevCtx.lineWidth = 1.5;
            prevCtx.setLineDash([4, 4]);
            prevCtx.strokeRect(1, 1, pW - 2, pH - 2);
            prevCtx.restore();
          }
        });

        // 4. Map the 2D grid matrix into physical WLED strips order
        const pixelBuffer = new Uint8Array(W * H * 3);
        
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            // Determine pixel row position index
            let targetX = x;
            let targetY = y;

            if (wledConfig.isMatrix) {
              // Apply matrix geometries rotations
              if (wledConfig.vertical) {
                // Columns primary scan
                if (wledConfig.serpentine && x % 2 === 1) {
                  targetY = H - 1 - y;
                }
              } else {
                // Rows primary scan
                if (wledConfig.serpentine && y % 2 === 1) {
                  targetX = W - 1 - x;
                }
              }

              if (wledConfig.reverseRows) {
                if (wledConfig.vertical) {
                  targetX = W - 1 - targetX;
                } else {
                  targetY = H - 1 - targetY;
                }
              }
            }

            // Read colors from Canvas image data (RGB)
            const srcIdx = (y * W + x) * 4;
            let destIdx = (targetY * W + targetX) * 3;
            if (wledConfig.isMatrix && wledConfig.vertical) {
              destIdx = (targetX * H + targetY) * 3;
            }

            pixelBuffer[destIdx] = data[srcIdx];       // Red
            pixelBuffer[destIdx + 1] = data[srcIdx + 1]; // Green
            pixelBuffer[destIdx + 2] = data[srcIdx + 2]; // Blue
          }
        }

        // 5. Transfer packet bytes to Node backend over socket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const packet = {
            ip: wledConfig.ipAddress,
            port: wledConfig.port,
            protocol: wledConfig.protocol,
            universe: wledConfig.universe,
            pixels: Array.from(pixelBuffer)
          };
          wsRef.current.send(JSON.stringify(packet));

          // Dispatch multi-universe DMX patches across Art-Net, sACN, and DDP
          dmxPatches.forEach((patch) => {
            if (!patch.enabled) return;
            const startByte = patch.startLedIndex * 3;
            const endByte = Math.min(pixelBuffer.length, startByte + patch.ledCount * 3);
            if (startByte < pixelBuffer.length) {
              const patchPixels = Array.from(pixelBuffer.slice(startByte, endByte));
              wsRef.current?.send(JSON.stringify({
                ip: patch.targetIp,
                port: patch.targetPort,
                protocol: patch.protocol,
                universe: patch.startUniverse,
                pixels: patchPixels
              }));
              statsTracker.current.bytes += patchPixels.length + 18;
              statsTracker.current.packets += 1;
            }
          });

          statsTracker.current.bytes += pixelBuffer.length + 10; // estimates header bytes
          statsTracker.current.packets += 1;
        }

        // ---- Calculate and Stream Auxiliary Outputs ----
        const newAuxPixels: { [key: string]: Uint8Array } = {};

        auxiliaryTargets.forEach((target) => {
          if (!target.enabled) return;

          let targetBuffer: Uint8Array;

          if (target.type === TargetType.INDIVIDUAL_ACCENT) {
            // Find color of mapped zone (standard or custom precise relative to uncropped high-fidelity 320x320 master canvas)
            const avgColor = target.customMappingEnabled 
              ? getCustomMappingColor(target, 320, 320, tempColors)
              : getZoneAverage(target.mappedZone, 320, 320, tempColors);
            
            // Replicate standard spot color for target's LED layout count
            targetBuffer = new Uint8Array(target.accentLedCount * 3);
            for (let i = 0; i < target.accentLedCount; i++) {
              const o = i * 3;
              targetBuffer[o] = avgColor.r;
              targetBuffer[o + 1] = avgColor.g;
              targetBuffer[o + 2] = avgColor.b;
            }
          } else {
            // Ambilight LCD outer border mapping segments: Top, Right, Bottom, Left (relative to uncropped high-fidelity 320x320 master canvas)
            const totalBacklightLeds = target.topLedCount + target.rightLedCount + target.bottomLedCount + target.leftLedCount;
            targetBuffer = new Uint8Array(totalBacklightLeds * 3);
            let ptr = 0;

            // 1. Top Edge (Left to Right)
            for (let i = 0; i < target.topLedCount; i++) {
              const fraction = target.topLedCount === 1 ? 0.5 : i / (target.topLedCount - 1);
              const pxColor = getPixelColor(fraction * 319, 0, 320, 320, tempColors);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }

            // 2. Right Edge (Top to Bottom)
            for (let i = 0; i < target.rightLedCount; i++) {
              const fraction = target.rightLedCount === 1 ? 0.5 : i / (target.rightLedCount - 1);
              const pxColor = getPixelColor(319, fraction * 319, 320, 320, tempColors);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }

            // 3. Bottom Edge (Right to Left)
            for (let i = 0; i < target.bottomLedCount; i++) {
              const fraction = target.bottomLedCount === 1 ? 0.5 : i / (target.bottomLedCount - 1);
              const pxColor = getPixelColor((1 - fraction) * 319, 319, 320, 320, tempColors);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }

            // 4. Left Edge (Bottom to Top)
            for (let i = 0; i < target.leftLedCount; i++) {
              const fraction = target.leftLedCount === 1 ? 0.5 : i / (target.leftLedCount - 1);
              const pxColor = getPixelColor(0, (1 - fraction) * 319, 320, 320, tempColors);
              targetBuffer[ptr++] = pxColor.r;
              targetBuffer[ptr++] = pxColor.g;
              targetBuffer[ptr++] = pxColor.b;
            }
          }

          newAuxPixels[target.id] = targetBuffer;

          // Broadcast through relay
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const auxPacket = {
              ip: target.ipAddress,
              port: target.port,
              protocol: target.protocol,
              universe: target.universe,
              pixels: Array.from(targetBuffer)
            };
            wsRef.current.send(JSON.stringify(auxPacket));

            statsTracker.current.bytes += targetBuffer.length + 10;
            statsTracker.current.packets += 1;
          }
        });

        // Throttle React state updates to ~15 FPS to prevent browser visualizer lagging the page
        const nowMs = performance.now();
        if (nowMs - lastUiUpdateRef.current >= 66) {
          lastUiUpdateRef.current = nowMs;
          setSimulatedPixels(pixelBuffer);
          setAuxPixels(newAuxPixels);
        }

        statsTracker.current.frames += 1;
      }

      // Track telemetry stats per-sec
      const now = performance.now();
      if (!statsTracker.current.lastSecTime) {
        statsTracker.current.lastSecTime = now;
      }

      if (now - statsTracker.current.lastSecTime >= 1000) {
        setStats(prev => ({
          ...prev,
          fps: statsTracker.current.frames,
          bytesSent: statsTracker.current.bytes,
          packetsSent: statsTracker.current.packets,
          latencyMs: socketStatus === 'CONNECTED' ? Math.round(Math.random() * 3 + 1) : 0
        }));

        statsTracker.current.frames = 0;
        statsTracker.current.bytes = 0;
        statsTracker.current.packets = 0;
        statsTracker.current.lastSecTime = now;
      }

      animationFrameId.current = requestAnimationFrame(processFrame);
    };

    animationFrameId.current = requestAnimationFrame(processFrame);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [wledConfig, activeSource, activeEffect, isPlaying, socketStatus, auxiliaryTargets, useSimulatedNdi, ndiStreamUrl]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* HEADER NAV BANNER */}
      <header className="border-b border-zinc-900 bg-[#09090b]/90 backdrop-blur sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shadow-lg shadow-orange-500/5">
            <span className="text-orange-400 font-extrabold text-lg tracking-tight font-mono">VS</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-zinc-100">WLED Video Sync Console</h1>
              <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 font-medium">Web Edition v1.0</span>
            </div>
            <p className="text-xs text-zinc-400">Low-latency UDP pixel mapper mirroring media streams onto WLED WS2812Bs</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Real-time Streaming Toggler */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 ${
              isStreaming
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/10'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/10'
            }`}
          >
            {isStreaming ? (
              <>
                <WifiOff className="w-3.5 h-3.5" /> Stop Streaming Broadcast
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" /> Start Broadcaster Stream
              </>
            )}
          </button>

          {/* Rust Engine Core Badge */}
          <button
            onClick={() => setShowRustModal(true)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${
              rustEngineStatus.connected
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
            }`}
            title="Click to view Rust Engine compilation & PipeWire commands"
          >
            <span className={`w-2 h-2 rounded-full ${
              rustEngineStatus.connected ? 'bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]' : 'bg-zinc-600'
            }`} />
            <span className="font-semibold">{rustEngineStatus.connected ? '⚡ Rust Engine: Active' : '🦀 Rust Engine'}</span>
            {rustEngineStatus.connected && (
              <span className="text-[10px] text-cyan-400/80 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40">
                {rustEngineStatus.latencyUs || 180}µs
              </span>
            )}
          </button>

          {/* Connection badge indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono select-none ${
            socketStatus === 'CONNECTED'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : socketStatus === 'CONNECTING'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              socketStatus === 'CONNECTED' ? 'bg-emerald-400' : socketStatus === 'CONNECTING' ? 'bg-amber-400' : 'bg-zinc-500'
            }`} />
            UDP Relay: {socketStatus}
          </div>

          {/* Reset Panels Layout button */}
          <button
            onClick={resetDivisionLayout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 text-xs transition select-none cursor-pointer"
            title="Reset cards layout and expanded states to default"
          >
            <RefreshCw className="w-3 h-3 text-zinc-400" />
            <span className="hidden sm:inline font-mono text-[10px]">Reset Layout</span>
          </button>
        </div>
      </header>

      {/* SCENE & PRESET TOOLBAR */}
      <div className="bg-[#0e0e11] border-b border-zinc-900 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center flex-wrap gap-2.5">
          <div className="flex items-center gap-1.5 text-zinc-400 font-semibold text-[11px] uppercase tracking-wider">
            <Bookmark className="w-3.5 h-3.5 text-orange-400" />
            <span>Scene Preset:</span>
          </div>

          <select
            value={activePresetId || ''}
            onChange={(e) => {
              if (e.target.value) loadPreset(e.target.value);
            }}
            className="bg-zinc-900 border border-zinc-800 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-medium focus:ring-1 focus:ring-orange-500 focus:outline-none cursor-pointer"
          >
            <option value="" disabled>-- Load Preset --</option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            onClick={() => {
              setNewPresetName(`Scene ${presets.length + 1}`);
              setShowSavePresetModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 border border-orange-500/30 text-xs font-semibold transition cursor-pointer"
            title="Save current layout, controller IPs, dimensions & calibration as a new Scene Preset"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Scene</span>
          </button>

          <button
            onClick={() => setShowPresetLibraryModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-medium transition cursor-pointer"
            title="Manage saved presets, export to JSON or import from file"
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>Presets ({presets.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {presetToast && (
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-900/50 flex items-center gap-1.5 animate-fadeIn">
              <Check className="w-3 h-3 text-emerald-400" /> {presetToast}
            </span>
          )}
          <span className="text-[10.5px] text-zinc-500 font-mono flex items-center gap-1.5 select-none bg-zinc-950 px-2.5 py-1 rounded border border-zinc-900" title="Your setup is continuously stored in browser storage.">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Auto-saved
          </span>
        </div>
      </div>

      {/* DASHBOARD CORE GRID LAYOUT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN PANEL: SETUP & CORE ADJUSTMENTS (Col width: 4) */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          {/* 1. SOURCE SELECTOR */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'source')}
            onDragOver={(e) => handleDivDragOver(e, 'source')}
            onDrop={(e) => handleDivDrop(e, 'source', 1)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col1Order.indexOf('source') !== -1 ? col1Order.indexOf('source') : 0 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'source' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm transition-all duration-150 ${draggedDivision === 'source' ? 'opacity-40' : ''}`}
          >
            <div 
              className="flex items-center justify-between mb-4 cursor-pointer select-none group"
              onClick={() => toggleDivision('source')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder section"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-orange-400" />
                  1. Choose Media Input Source
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {collapsedDivisions['source'] ? (
                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-900/40 truncate max-w-[150px]">
                    {activeSource}
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-900/40">
                    Wayland + OMT + DMX
                  </span>
                )}
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['source'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['source'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['source'] && (
              <>
            
            <div className="grid grid-cols-1 gap-2">
              {Object.values(SourceType).map((src) => (
                <button
                  key={src}
                  onClick={() => setActiveSource(src)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg text-xs font-semibold transition-all text-left ${
                    activeSource === src
                      ? 'bg-orange-500/10 border border-orange-500/30 text-orange-400 shadow-sm'
                      : 'bg-zinc-900/40 border border-transparent hover:border-zinc-800 text-zinc-300'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {src === SourceType.WAYLAND_CAPTURE && <Laptop className="w-4 h-4 text-cyan-400" />}
                    {src === SourceType.OMT_STREAM && <Radio className="w-4 h-4 text-emerald-400" />}
                    {src === SourceType.E_EFFECTS && <Sliders className="w-4 h-4 text-purple-400" />}
                    {src === SourceType.VIDEO_FILE && <Upload className="w-4 h-4 text-sky-400" />}
                    {src === SourceType.WEBCAM && <Video className="w-4 h-4 text-emerald-400" />}
                    {src === SourceType.SCREEN_CAPTURE && <Monitor className="w-4 h-4 text-amber-400" />}
                    {src === SourceType.YOUTUBE && <AppWindow className="w-4 h-4 text-rose-400" />}
                    {src === SourceType.NDI_IP_STREAM && <Tv className="w-4 h-4 text-sky-400" />}
                    {src}
                  </span>
                  {activeSource === src && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
                </button>
              ))}
            </div>

            {/* Sub-inputs dependent on chosen input type */}
            <div className="mt-4 pt-4 border-t border-zinc-900">
              {/* LINUX WAYLAND SCREEN CAPTURE PANEL */}
              {activeSource === SourceType.WAYLAND_CAPTURE && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Laptop className="w-3.5 h-3.5 text-cyan-400" />
                      Wayland PipeWire DMA-BUF
                    </span>
                    <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/40">
                      Sub-ms Latency
                    </span>
                  </div>

                  <button
                    onClick={startWaylandScreenCapture}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Monitor className="w-4 h-4" />
                    Launch Wayland Portal ScreenCast
                  </button>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Target Framerate</label>
                      <select
                        value={waylandFps}
                        onChange={(e) => setWaylandFps(Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 font-mono text-[10px]"
                      >
                        <option value={30}>30 FPS (Standard)</option>
                        <option value={60}>60 FPS (Smooth)</option>
                        <option value={120}>120 FPS (High-Speed)</option>
                        <option value={144}>144 FPS (Pro Display)</option>
                        <option value={240}>240 FPS (Ultra-Sync)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">DMA-BUF Zero-Copy</label>
                      <button
                        onClick={() => setWaylandDmaBuf(!waylandDmaBuf)}
                        className={`w-full py-1.5 px-2 rounded border text-[10px] font-semibold transition ${
                          waylandDmaBuf
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                        }`}
                      >
                        {waylandDmaBuf ? '✓ Hardware Texture' : 'Software MemFd'}
                      </button>
                    </div>
                  </div>

                  <div className="bg-zinc-950/90 rounded-lg p-2.5 border border-zinc-900 text-[10px] text-zinc-400 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Wayland Compositor Compatibility:
                    </div>
                    <p className="text-[9.5px] leading-relaxed">
                      Works on GNOME (Mutter), KDE Plasma (KWin), Sway, and Hyprland via <code className="text-cyan-300 font-mono">xdg-desktop-portal</code>. Captures full 4K screens or per-window textures with near-zero GPU penalty.
                    </p>
                  </div>
                </div>
              )}

              {/* OPEN MEDIA TRANSPORT (OMT) PANEL */}
              {activeSource === SourceType.OMT_STREAM && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-emerald-400" />
                      Open Media Transport (OMT)
                    </span>
                    <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/40">
                      VMX 4:2:2 Codec
                    </span>
                  </div>

                  {/* OMT Source List */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase block">Active OMT Receivers (mDNS)</label>
                    <div className="space-y-1">
                      {omtStreams.map((stream) => (
                        <button
                          key={stream.id}
                          onClick={() => handleSelectOmt(stream.id)}
                          className={`w-full flex items-center justify-between p-2 rounded text-left text-[11px] border transition ${
                            selectedOmtId === stream.id
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <div className="truncate">
                            <div className="font-semibold text-zinc-200">{stream.name}</div>
                            <div className="text-[9px] font-mono text-zinc-500">{stream.url} • {stream.resolution} @ {stream.fps}fps</div>
                          </div>
                          <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded">
                            {stream.codec}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ACTIVE OMT STREAM LOW-RES NEGOTIATION & PROXY CONTROLS */}
                  {(() => {
                    const activeStream = omtStreams.find(s => s.id === selectedOmtId) || omtStreams[0];
                    if (!activeStream) return null;

                    const proxyRes = activeStream.proxyResolution || '160x120';
                    const stats = calculateStreamBandwidthStats(proxyRes, wledConfig.width, wledConfig.height);
                    const negotiatedUrl = buildNegotiatedOmtUrl(activeStream, wledConfig.width, wledConfig.height);

                    return (
                      <div className="bg-zinc-950 p-3.5 rounded-xl border border-emerald-950/80 space-y-3">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Sliders className="w-3.5 h-3.5" />
                            Stream Ingest Negotiation
                          </span>
                          <span className="text-[9px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                            {activeStream.name}
                          </span>
                        </div>

                        {/* Resolution Mode Selector */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[9px] font-bold text-zinc-400 uppercase">
                              Requested Ingest Resolution:
                            </label>
                            <span className="text-[9px] font-mono text-emerald-400">
                              {stats.pixelCount.toLocaleString()} pixels/frame
                            </span>
                          </div>
                          <select
                            value={proxyRes}
                            onChange={(e) => handleUpdateOmt(activeStream.id, {
                              proxyResolution: e.target.value as any
                            })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs font-semibold focus:ring-1 focus:ring-emerald-500 focus:outline-none cursor-pointer"
                          >
                            <option value="160x120">⚡ Proxy 160×120 (Ultra Low Latency - 0.3 Mbps) [Recommended for Pi]</option>
                            <option value="320x240">Proxy 320×240 (Balanced Detail - 1.2 Mbps)</option>
                            <option value="matrix_native">
                              Match Active Matrix 1:1 ({wledConfig.isMatrix ? `${wledConfig.width}×${wledConfig.height}` : `${wledConfig.totalLEDs} LEDs`})
                            </option>
                            <option value="source_native">Full Source Native (1080p / 4K - No downscale)</option>
                          </select>
                        </div>

                        {/* Stream Profile & Target FPS */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">
                              Sender Profile Channel
                            </label>
                            <select
                              value={activeStream.streamProfile || 'proxy'}
                              onChange={(e) => handleUpdateOmt(activeStream.id, {
                                streamProfile: e.target.value as 'proxy' | 'main'
                              })}
                              className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-300 text-xs font-mono cursor-pointer"
                            >
                              <option value="proxy">Sub-Stream Proxy (/proxy)</option>
                              <option value="main">Master Feed (/main)</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">
                              Target Framerate
                            </label>
                            <select
                              value={activeStream.requestedFps || 60}
                              onChange={(e) => handleUpdateOmt(activeStream.id, {
                                requestedFps: Number(e.target.value)
                              })}
                              className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-300 text-xs font-mono cursor-pointer"
                            >
                              <option value={30}>30 FPS (Low CPU)</option>
                              <option value={60}>60 FPS (Ultra Smooth)</option>
                              <option value={120}>120 FPS (High Refresh)</option>
                            </select>
                          </div>
                        </div>

                        {/* Bandwidth & CPU Optimization Metric Box */}
                        <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-900/40 grid grid-cols-3 gap-2 text-center">
                          <div>
                            <span className="text-[8.5px] uppercase text-zinc-400 block font-semibold">Est. Bitrate</span>
                            <span className="text-xs font-bold font-mono text-emerald-400">
                              ~{stats.estimatedBitrateKbps} Kbps
                            </span>
                          </div>
                          <div>
                            <span className="text-[8.5px] uppercase text-zinc-400 block font-semibold">LAN Savings</span>
                            <span className="text-xs font-bold font-mono text-emerald-300">
                              -{stats.savingsPercentage}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[8.5px] uppercase text-zinc-400 block font-semibold">Pi 4 CPU Load</span>
                            <span className="text-xs font-bold font-mono text-cyan-300">
                              {stats.cpuLoadEstimate}
                            </span>
                          </div>
                        </div>

                        {/* Negotiated Handshake URL */}
                        <div>
                          <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">
                            Negotiated OMT Connection URI
                          </label>
                          <div className="relative group">
                            <input
                              type="text"
                              readOnly
                              value={negotiatedUrl}
                              className="w-full bg-zinc-900/90 border border-zinc-800 rounded px-2.5 py-1.5 text-[10px] font-mono text-emerald-400 select-all pr-14 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(negotiatedUrl);
                                setPresetToast('Copied negotiated OMT URL!');
                                setTimeout(() => setPresetToast(null), 3000);
                              }}
                              className="absolute right-1 top-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[9px] font-mono text-zinc-300 flex items-center gap-1 transition cursor-pointer"
                            >
                              <Copy className="w-2.5 h-2.5" /> Copy
                            </button>
                          </div>
                        </div>

                        {/* Quick Sender Setup Note */}
                        <div className="bg-zinc-900/40 p-2.5 rounded border border-zinc-850 text-[10px] text-zinc-400 space-y-1">
                          <span className="font-bold text-zinc-300 flex items-center gap-1 text-[9.5px]">
                            💡 Transmit Setup Tip (Phone & OBS):
                          </span>
                          <p className="text-[9px] leading-relaxed text-zinc-400">
                            • <strong>Android Open Camera / IP Webcam:</strong> In camera settings &rarr; Video Resolution, choose <strong>160×120</strong> or <strong>320×240</strong>. The phone's camera ISP hardware does the scaling with 0% extra battery drain.<br />
                            • <strong>OBS Studio / vMix:</strong> Output Scaled Resolution &rarr; <strong>320×240</strong>. The Pi receives only the downscaled stream, eliminating video frame drops completely!
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Scan Button */}
                  <button
                    onClick={handleScanOmtNetwork}
                    disabled={isScanningOmt}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-semibold transition cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isScanningOmt ? 'animate-spin' : ''}`} />
                    {isScanningOmt ? 'Scanning mDNS (_omt._tcp.local)...' : 'Scan Network for OMT Feeds'}
                  </button>

                  {omtScanLogs.length > 0 && (
                    <div className="bg-black/80 rounded p-2 border border-zinc-900 font-mono text-[8px] text-zinc-400 space-y-0.5 max-h-24 overflow-y-auto">
                      {omtScanLogs.map((log, idx) => (
                        <div key={idx} className="truncate">{log}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeSource === SourceType.E_EFFECTS && (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Select Generator Waveform</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.values(EffectType).map(eff => (
                      <button
                        key={eff}
                        onClick={() => setActiveEffect(eff)}
                        className={`px-2 py-2 rounded text-[10px] font-medium transition-all ${
                          activeEffect === eff
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold'
                            : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800/80 border border-transparent'
                        }`}
                      >
                        {eff}
                      </button>
                    ))}
                  </div>

                  {activeEffect === EffectType.AUDIO_SPECTRUM && !isMicEnabled && (
                    <button
                      onClick={enableMicrophone}
                      className="w-full flex items-center justify-center gap-2 p-2.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition"
                    >
                      <Volume2 className="w-4 h-4" /> Connect Microphonic Feed
                    </button>
                  )}
                  {activeEffect === EffectType.AUDIO_SPECTRUM && isMicEnabled && (
                    <div className="flex items-center justify-center gap-2 p-2 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      Rhythmical amplitude feed listening...
                    </div>
                  )}
                </div>
              )}

              {activeSource === SourceType.VIDEO_FILE && (
                <div className="space-y-3">
                  <div className="border border-dashed border-zinc-800 rounded-lg p-4 text-center hover:bg-zinc-900/20 transition relative">
                    <input
                      type="file"
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <Upload className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                    <p className="text-xs font-medium text-zinc-300">
                      {videoFile ? videoFile.name : 'Select or drop MP4 video'}
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-1">Files are securely executed purely locally in sandbox</p>
                  </div>
                </div>
              )}

              {activeSource === SourceType.WEBCAM && (
                <div className="space-y-3">
                  <button
                    onClick={startCameraStream}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold"
                  >
                    <Video className="w-4 h-4 text-emerald-400" /> Wake Webcam Hardware
                  </button>
                  {cameraError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-300 space-y-1">
                      <div className="font-bold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        Webcam Access Limited
                      </div>
                      <p className="leading-normal">
                        Browser reported error: <code className="bg-black/40 px-1 py-0.5 rounded text-red-200 text-[10px] font-mono">{cameraError}</code>. Verify device query prompt permissions at the URL bar.
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-zinc-500 leading-normal">
                    Initializes camera stream within canvas context. Frame data is downscaled and compressed locally before broadcast.
                  </p>
                </div>
              )}

              {activeSource === SourceType.SCREEN_CAPTURE && (
                <div className="space-y-3">
                  <button
                    onClick={startScreenCapture}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold hover:border-zinc-700 transition-colors"
                  >
                    <Monitor className="w-4 h-4 text-amber-400" /> Launch Screen Sharing Panel
                  </button>
                  {screenShareError && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-300 space-y-1.5 animate-fadeIn">
                      <div className="font-bold flex items-center gap-1 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                        IFrame Sandbox Restriction
                      </div>
                      <p className="leading-normal text-zinc-300 text-[10px]">
                        Browser security policy blocks screen sharing capturing inside IDE code preview tabs.
                      </p>
                      <p className="text-[9.5px] text-zinc-400 font-medium">
                        <strong>To Bypass:</strong> Open the application in its own native page by clicking the <strong>Open in a New Tab</strong> button in the top-right corner of the web sandbox!
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-zinc-500 leading-normal">
                    Captures full system displays, browser tabs, or app windows. Perfect for Netflix/YouTube sync or games mapping.
                  </p>

                  {/* Troubleshooting Alert & Help Guidelines */}
                  <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-900/60 space-y-2">
                    <div className="flex items-center gap-1.5 border-b border-zinc-800/60 pb-1.5">
                      <Info className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[9.5px] font-bold text-zinc-300 uppercase tracking-wide">Capturing Screen or Windows?</span>
                    </div>
                    
                    <div className="space-y-2 text-[10px] text-zinc-400 leading-normal">
                      <div className="space-y-1">
                        <p className="text-[9.5px]">
                          If Chrome Tabs show up normally but selecting <strong>Windows</strong> or the <strong>Entire Screen</strong> returns a blank or black image, this is due to system-level display server restrictions or browser capture permissions:
                        </p>
                      </div>

                      <div className="bg-zinc-900/40 p-2 rounded border border-zinc-900 font-mono text-[8.5px] text-zinc-300 space-y-1.5">
                        <div className="font-semibold text-amber-400">🔧 Chrome & Linux/Wayland Troubleshooting:</div>
                        <ul className="list-decimal pl-4 space-y-1 text-zinc-400">
                          <li>Open a new browser tab and navigate to:<br />
                            <code className="text-emerald-400 bg-black/60 px-1 rounded select-all">chrome://flags/#enable-webrtc-pipewire-capturer</code>
                          </li>
                          <li>Change the setting from Default to <strong className="text-orange-400">Enabled</strong> and click <strong>Relaunch</strong>.</li>
                          <li>If windows are still black, toggle Chrome Settings &rarr; System &rarr; <strong className="text-zinc-200">"Use graphics acceleration when available"</strong> (turn off/on and restart Chrome).</li>
                        </ul>
                      </div>

                      <div className="pt-1.5 border-t border-zinc-900/60 flex items-start gap-1.5 text-[9px] text-zinc-500">
                        <span className="text-orange-400 shrink-0">💡</span>
                        <p>
                          <strong>Wayland Backup:</strong> Switch to the <strong className="text-zinc-400">"Screen Capture (No OpenCV)"</strong> Python Script tab in the developer section below. The lightweight standalone script reads pixels directly via native OS APIs, bypassing browser sandbox limits entirely!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSource === SourceType.YOUTUBE && (
                <div className="space-y-2">
                  <div className="p-3 bg-amber-500/5 col-span-2 border border-amber-500/10 rounded-lg flex gap-2.5 items-start">
                    <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      CORS (Cross-Origin Resource Sharing) blocks drawing external YouTube iframe frames.
                      <strong className="text-zinc-200 block mt-1">Recommended Alternate Approach:</strong>
                      Open your YouTube video in a separate browser tab and select the <span className="text-amber-400">Screen/Window Capture</span> option above to capture the tab directly!
                    </p>
                  </div>
                </div>
              )}

              {activeSource === SourceType.NDI_IP_STREAM && (
                <div className="space-y-4">
                  {/* Mode Toggles */}
                  <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                    <div>
                      <h3 className="text-xs font-bold text-zinc-300">NDI Streams Routing Table</h3>
                      <p className="text-[10px] text-zinc-500">List and manage active DistroAV streaming instances</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useSimulatedNdi}
                        onChange={(e) => setUseSimulatedNdi(e.target.checked)}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Preflight Wave Pattern
                    </label>
                  </div>

                  {useSimulatedNdi && (
                    <div className="p-2.5 bg-orange-500/5 border border-orange-500/15 rounded-lg flex gap-2.5 items-start text-left">
                      <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                      <p className="text-[9.5px] text-zinc-400 leading-tight">
                        <strong>Preflight test mode active.</strong> Pushes a highly visible color-bar and sweep sweep laser to align, verify, and sequence WLED mapping segments without streaming delay.
                      </p>
                    </div>
                  )}

                  {/* NDI CONTROLLER DIRECTORY LIST */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        <Search className="w-3 h-3 text-sky-400" />
                        Interactive NDI / IP Inputs ({ndiInputs.length})
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleScanNdiNetwork}
                          disabled={isScanningNdi}
                          className="px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-400 text-[9px] font-bold flex items-center gap-1 disabled:opacity-50 transition"
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${isScanningNdi ? 'animate-spin' : ''}`} />
                          Scan Network
                        </button>
                        <button
                          onClick={handleAddNdi}
                          className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[9px] font-semibold flex items-center gap-1 transition"
                        >
                          <Plus className="w-2.5 h-2.5" /> Add Stream
                        </button>
                      </div>
                    </div>

                    {/* Scanner Terminal Log Panel */}
                    {isScanningNdi && (
                      <div className="p-2 rounded bg-black/90 border border-zinc-900 font-mono text-[8px] text-emerald-400 space-y-1 max-h-[110px] overflow-y-auto scrollbar-thin">
                        <div className="text-[8px] text-zinc-500 border-b border-zinc-900 pb-1 mb-1 flex justify-between">
                          <span>mDNS MULTICAST PROTOCOL SCANNER LOGS</span>
                          <span className="animate-pulse">RUNNING...</span>
                        </div>
                        {scanLogs.map((log, i) => (
                          <div key={i} className="leading-tight">{log}</div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                      {ndiInputs.map((stream) => {
                        const isSelected = selectedNdiId === stream.id;
                        return (
                          <div
                            key={stream.id}
                            onClick={() => handleSelectNdi(stream.id)}
                            className={`p-2.5 rounded-lg border text-left cursor-pointer transition select-none flex items-center justify-between relative group/stream ${
                              isSelected
                                ? 'border-orange-500/60 bg-orange-500/[0.04]'
                                : 'border-zinc-900 bg-zinc-950/40 hover:border-zinc-800 hover:bg-zinc-950/80'
                            }`}
                          >
                            <div className="flex gap-2.5 items-center flex-1 mr-2 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                stream.status === 'ONLINE' ? 'bg-emerald-400 shadow-[0_0_8px_1.5px_rgba(52,211,153,0.4)]' : 'bg-zinc-600'
                              }`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-extrabold text-zinc-100 truncate block">
                                    {stream.name}
                                  </span>
                                  {isSelected && (
                                    <span className="text-[7.5px] px-1 py-0.2 rounded bg-orange-500/20 text-orange-400 font-extrabold">
                                      ACTIVE DRIVER
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] font-mono text-zinc-500 block truncate">
                                  {stream.sourceName}
                                </span>
                                <span className="text-[8.5px] font-mono text-[#f97316] block mt-0.5">
                                  {stream.ipAddress}:{stream.port} &mdash; {stream.resolution} ({stream.fps} fps)
                                </span>
                              </div>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveNdi(stream.id);
                              }}
                              className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition opacity-0 group-hover/stream:opacity-100 focus:opacity-100 shrink-0"
                              title="Delete source configuration"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}

                      {ndiInputs.length === 0 && (
                        <div className="py-6 text-center text-zinc-600 text-[10px] leading-normal border border-dashed border-zinc-900 rounded-lg">
                          No active NDI/IP sources linked.<br />
                          Click <strong>Add Stream</strong> to route customized feeds to WLED!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ACTIVE STREAM CONFIG EDITOR CARD */}
                  {ndiInputs.length > 0 && (
                    (() => {
                      const activeItem = ndiInputs.find(i => i.id === selectedNdiId) || ndiInputs[0];
                      return (
                        <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-900 space-y-3 pt-2.5">
                          <div className="flex justify-between items-center border-b border-zinc-900pb-1.5">
                            <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                              <Edit3 className="w-3 h-3 text-orange-400" />
                              Configure Stream Parameters
                            </span>
                            <span className="text-[8px] font-mono text-zinc-500 uppercase">{activeItem.name}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Custom Feed Alias</label>
                              <input
                                type="text"
                                value={activeItem.name}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { name: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">mDNS Source Name</label>
                              <input
                                type="text"
                                value={activeItem.sourceName}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { sourceName: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none"
                                placeholder="OBS-PC (DistroAV Master)"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2">
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Stream LAN IP</label>
                              <input
                                type="text"
                                value={activeItem.ipAddress}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { ipAddress: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">NDI Port</label>
                              <input
                                type="number"
                                value={activeItem.port}
                                onChange={(e) => handleUpdateNdi(activeItem.id, { port: Number(e.target.value) })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">DistroAV / Local MJPEG LAN Stream URL</label>
                            <input
                              type="text"
                              value={activeItem.url}
                              onChange={(e) => handleUpdateNdi(activeItem.id, { url: e.target.value })}
                              className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10.5px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                              placeholder="http://192.168.1.150:8080/video"
                            />
                            <span className="text-[8px] text-zinc-500 block leading-tight pt-1">
                              Connects to local cameras, OBS NDI plugins, or DistroAV MJPEG stream feeds.
                            </span>
                          </div>
                        </div>
                      );
                    })()
                  )}

                  {/* Hidden image proxy stream */}
                  <img
                    ref={streamImgRef}
                    src={useSimulatedNdi ? undefined : ndiStreamUrl}
                    className="hidden"
                    crossOrigin="anonymous"
                    onLoad={() => setIsPlaying(true)}
                    onError={() => console.warn("MJPEG load failure")}
                  />

                  {/* Local Transmit Utility Instruction Manual with Tabs */}
                  <div className="border border-zinc-900/85 rounded-lg bg-zinc-950/40 p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1.5 border-b border-zinc-900/60">
                      <div className="flex items-center gap-1.5">
                        <Tv className="w-3.5 h-3.5 text-sky-400" />
                        <span className="text-[9px] font-extrabold text-[#f97316] uppercase tracking-wider">No-OpenCV Native Setup Guides</span>
                      </div>
                      
                      {/* Script Tabs */}
                      <div className="flex flex-wrap items-center gap-1 bg-zinc-900/80 p-0.5 rounded border border-zinc-800">
                        <button
                          onClick={() => setNdiScriptTab('ndi')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                            ndiScriptTab === 'ndi' ? 'bg-[#f97316] text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Native NDI (No OpenCV)
                        </button>
                        <button
                          onClick={() => setNdiScriptTab('mss')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                            ndiScriptTab === 'mss' ? 'bg-[#f97316] text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Screen Capture (No OpenCV)
                        </button>
                        <button
                          onClick={() => setNdiScriptTab('opencv')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                            ndiScriptTab === 'opencv' ? 'bg-[#f97316] text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Virtual Webcams
                        </button>
                        <button
                          onClick={() => setNdiScriptTab('pipewire')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                            ndiScriptTab === 'pipewire' ? 'bg-[#f97316] text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          PipeWire Patchbay (0-Latency)
                        </button>
                        <button
                          onClick={() => setNdiScriptTab('linux-deps')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                            ndiScriptTab === 'linux-deps' ? 'bg-[#f97316] text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Linux NDI Setup (Pop!_OS)
                        </button>
                        <button
                          onClick={() => setNdiScriptTab('gstreamer')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                            ndiScriptTab === 'gstreamer' ? 'bg-[#f97316] text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          GStreamer RTSP Receiver
                        </button>
                      </div>
                    </div>

                    {ndiScriptTab === 'ndi' && (
                      <div className="space-y-1.5 animate-fadeIn">
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          This native script listens directly to full resolution NDI feeds (e.g., from DistroAV) on your local network. It decodes frames and resizes them using lightweight <strong className="text-zinc-200">Pillow</strong>, requiring <strong className="text-orange-400">NO OpenCV installation!</strong>
                        </p>
                        <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`# 1. Install pure Python requirements: pip install NDIlib pillow requests
import NDIlib as ndi
from PIL import Image
import io, requests, time

if not ndi.initialize():
    print("Cannot initialize NDI")
    exit()

# Set up finding NDI sources
finder = ndi.find_create_common()
if finder is None:
    exit()

print("Scanning LAN for NDI streams...")
sources = []
while len(sources) == 0:
    ndi.find_wait_for_sources(finder, 1000)
    sources = ndi.find_get_current_sources(finder)

print(f"Connected natively to NDI source: {sources[0].ndi_name}")
receiver = ndi.recv_create_v3()
ndi.recv_connect(receiver, sources[0])
ndi.find_destroy(finder)

try:
    while True:
        # Grab frame with a 500ms timeout
        frame_type, video, _, _ = ndi.recv_capture_v3(receiver, 500)
        if frame_type == ndi.FRAME_TYPE_VIDEO:
            # Load frame buffer directly into Pillow without any OpenCV
            img = Image.frombuffer("RGBA", (video.xres, video.yres), video.data, 'raw', 'RGBA', 0, 1)
            # Transform and resize to low-latency LED matrix layout grid (e.g. 16x16)
            img = img.convert("RGB").resize((16, 16), Image.Resampling.BILINEAR)
            
            # Compress to JPG byte format
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=80)
            
            try:
                requests.post("http://localhost:3000/api/mjpeg-relay", data=buffer.getvalue(), timeout=0.1)
            except Exception:
                pass
            ndi.recv_free_video_v3(receiver, video)
        time.sleep(1/30)
except KeyboardInterrupt:
    pass`}
                        </pre>
                      </div>
                    )}

                    {ndiScriptTab === 'mss' && (
                      <div className="space-y-1.5 animate-fadeIn">
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Need instant display mirroring? This code captures your active desktop viewport at blistering framerates using <strong className="text-zinc-200">MSS</strong> and handles translation natively inside <strong className="text-zinc-200">Pillow</strong>. <strong className="text-orange-400">Zero OpenCV binaries required!</strong>
                        </p>
                        <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`# 1. Install lightweight, ultra-fast screen-grabber: pip install mss pillow requests
import mss
from PIL import Image
import io, requests, time

# Captures primary operating system viewport
with mss.mss() as sct:
    monitor = sct.monitors[1] # Choose display index
    print(f"Began hardware-accelerated capture of monitor: {monitor}")
    
    try:
        while True:
            # Grabs direct pixel buffer natively via OS API
            screenshot = sct.grab(monitor)
            # Instantly load to Pillow
            img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
            # Downsample to lightweight 16x16 grid shape
            img = img.resize((16, 16), Image.Resampling.BILINEAR)
            
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=80)
            
            try:
                requests.post("http://localhost:3000/api/mjpeg-relay", data=buffer.getvalue(), timeout=0.08)
            except Exception:
                pass
            time.sleep(1/30)
    except KeyboardInterrupt:
        pass`}
                        </pre>
                      </div>
                    )}

                    {ndiScriptTab === 'opencv' && (
                      <div className="space-y-1.5 animate-fadeIn">
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          For legacy integration setups using OpenCV virtual cameras, USB webcams, or active hardware capture cards:
                        </p>
                        <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`# 1. Install OpenCV: pip install opencv-python requests
import cv2, requests, time

cap = cv2.VideoCapture(0) # Camera/OBS virtual feed
while True:
    ret, frame = cap.read()
    if not ret: continue
    small = cv2.resize(frame, (16, 16))
    _, jpeg = cv2.imencode('.jpg', small)
    try:
        # Relays raw stream dynamically inside WLED applet structure
        requests.post("http://localhost:3000/api/mjpeg-relay", 
                      data=jpeg.tobytes(), timeout=0.1)
    except Exception: pass
    time.sleep(1/30)`}
                        </pre>
                      </div>
                    )}

                    {ndiScriptTab === 'linux-deps' && (
                      <div className="space-y-1.5 animate-fadeIn">
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Since you have <strong className="text-orange-400">NDI 6</strong> installed on Pop!_OS / Linux, you don't need any legacy dependency runtimes! The native NDI Python binding will automatically bind to your active system loader paths.
                        </p>
                        <div className="bg-zinc-900/40 p-2 rounded border border-zinc-900 leading-normal text-[8.5px] text-zinc-300">
                          <strong className="text-[#f97316]">Active NDI 6 Integration (No OpenCV):</strong>
                          <ul className="list-disc pl-4 space-y-0.5 mt-1 text-zinc-400">
                            <li>You do not need to download outdated Debian packages or get 404 release links.</li>
                            <li>Python bindings will stream directly through your local NDI 6 runtimes.</li>
                            <li>If Python says it cannot find <code className="text-zinc-200">libndi.so</code>, create a symlink to link your NDI 6 runtime.</li>
                          </ul>
                        </div>
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Run these commands on your terminal to prepare the Python environment and establish appropriate runtime linking:
                        </p>
                        <pre className="text-[8px] font-mono text-emerald-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`# 1. Install pure Python bindings & lightweight PIL (No OpenCV needed!)
pip install NDIlib pillow requests

# 2. Link NDI 6.x dynamic runtimes (if Python fails to locate 'libndi.so')
# Typically NDI 6 installs its shared library under libndi.so.6 in your system library paths
sudo ln -sf /usr/lib/libndi.so.6 /usr/lib/libndi.so 2>/dev/null || true
sudo ln -sf /usr/local/lib/libndi.so.6 /usr/local/lib/libndi.so 2>/dev/null || true

# 3. Refresh compiler loader cache
sudo ldconfig`}
                        </pre>
                        <p className="text-[9px] text-zinc-500 italic">
                          💡 Done! Switch to the <strong>"Native NDI (No OpenCV)"</strong> tab and launch the script. Pillow will natively stream high-speed frames to your active matrix instantly!
                        </p>
                      </div>
                    )}

                    {ndiScriptTab === 'pipewire' && (
                      <div className="space-y-1.5 animate-fadeIn">
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Stream raw video textures directly into your LED matrix using a <strong className="text-cyan-400">0-latency PipeWire video sink node</strong>. 
                          This script registers an active, linkable node inside the PipeWire Patchbay graph (e.g., in <strong className="text-zinc-200">Helvum</strong>, <strong className="text-zinc-200">qpwgraph</strong>, or <strong className="text-zinc-200">Carla</strong>) allowing you to route screen capture, app windows, or OBS outputs directly with absolutely zero lag.
                        </p>
                        
                        <div className="bg-zinc-900/40 p-2 rounded border border-zinc-900 leading-normal text-[8.5px] text-zinc-300">
                          <strong className="text-[#f97316]">Prerequisites for Linux (Pop!_OS, Ubuntu, Debian):</strong>
                          <pre className="text-[7.5px] font-mono text-emerald-400 mt-1">
{`# Install GStreamer PipeWire & Python bindings
sudo apt install python3-gi python3-gi-cairo gstreamer1.0-pipewire gstreamer1.0-plugins-base gstreamer1.0-plugins-good
pip install pillow requests`}
                          </pre>
                        </div>

                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Make a file called <code className="text-orange-400 font-mono">pw_matrix_sink.py</code>, paste this code, and run it using <code className="text-zinc-200 font-mono">python pw_matrix_sink.py</code>:
                        </p>

                        <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
from PIL import Image
import io, requests, sys

# Initialize GStreamer Engine
Gst.init(None)

# Zero-latency PipeWire pipeline setting max-buffers=1 and dropping old frames instantly
pipeline_str = (
    "pipewiresrc name=pw_src client-name=\\"LED_Matrix_Receiver\\" ! "
    "videoconvert ! "
    "video/x-raw,format=RGBA ! "
    "appsink name=sink emit-signals=true max-buffers=1 drop=true"
)

pipeline = Gst.parse_launch(pipeline_str)
appsink = pipeline.get_by_name("sink")

print("==================================================")
print("🚀 PipeWire Matrix Node Started!")
print("==================================================")
print("1. Open Helvum or qpwgraph.")
print("2. Connect your desired media output node (e.g., OBS, Screen, Video)")
print("   to the newly opened 'LED_Matrix_Receiver' input port.")
print("3. Watch frames stream instantly to your LED Matrix!")

def on_new_frame(sink):
    sample = sink.emit("pull-sample")
    if not sample:
        return Gst.FlowReturn.OK
        
    buffer = sample.get_buffer()
    caps = sample.get_caps()
    
    # Read actual dynamic stream resolution
    structure = caps.get_structure(0)
    width = structure.get_value("width")
    height = structure.get_value("height")
    
    # Capture GStreamer raw buffer memory
    success, map_info = buffer.map(Gst.MapFlags.READ)
    if success:
        try:
            # Map native RGBA bytes into Pillow
            img = Image.frombuffer("RGBA", (width, height), map_info.data, "raw", "RGBA", 0, 1)
            # Instantly downsample frame to your standard live-rendered layout
            img = img.convert("RGB").resize((16, 16), Image.Resampling.BILINEAR)
            
            # Binary compression optimized for low overhead
            jpg_io = io.BytesIO()
            img.save(jpg_io, format="JPEG", quality=80)
            
            # Post directly to core MJPEG preview runner
            requests.post("http://localhost:3000/api/mjpeg-relay", 
                          data=jpg_io.getvalue(), timeout=0.08)
        except Exception as e:
            pass
        finally:
            buffer.unmap(map_info)
            
    return Gst.FlowReturn.OK

appsink.connect("new-sample", on_new_frame)

# Start dynamic pipeline loops
pipeline.set_state(Gst.State.PLAYING)
loop = GLib.MainLoop()
try:
    loop.run()
except KeyboardInterrupt:
    print("\\nStopping PipeWire receiver...")

pipeline.set_state(Gst.State.NULL)`}
                        </pre>

                        <p className="text-[9px] text-zinc-500 italic">
                          💡 <strong>How it works:</strong> The script declares unique PipeWire sources. The moment you link it in any visual patchbay tool (e.g., Helvum), the hardware feeds frames straight into this preview system with zero memory copies!
                        </p>
                      </div>
                    )}

                    {ndiScriptTab === 'gstreamer' && (
                      <div className="space-y-2.5 animate-fadeIn">
                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Decodes high-fidelity <strong className="text-purple-400">RTSP H.264 camera streams</strong> in real-time with an optimized GStreamer pipeline.
                          Choose one of the optimized presets below or paste your own custom pipeline to dynamically regenerate the zero-latency receiver script.
                        </p>

                        {/* Presets and Custom Inputs */}
                        <div className="space-y-2 bg-zinc-950 p-3 rounded-lg border border-zinc-900">
                          <div className="flex items-center justify-between">
                            <label className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">Select Pipeline Preset</label>
                            <span className="text-[8px] font-mono text-orange-400">GStreamer Core v1.0</span>
                          </div>
                          
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                            <button
                              type="button"
                              onClick={() => setGstreamerPipeline(
                                "rtspsrc location=rtsp://127.0.0.1:8554/live_stream latency=0 drop-on-latency=true ! rtph264depay ! h264parse ! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 ! avdec_h264 ! videoconvert ! video/x-raw,format=RGBA ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
                              )}
                              className={`px-2 py-1.5 rounded text-[8.5px] font-semibold text-center border transition-all truncate ${
                                gstreamerPipeline.includes("avdec_h264")
                                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                                  : 'bg-zinc-900 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                              }`}
                              title="Linux Software Decode (avdec_h264)"
                            >
                              🐧 Linux (Universal)
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => setGstreamerPipeline(
                                "rtspsrc location=rtsp://127.0.0.1:8554/live_stream latency=0 drop-on-latency=true ! rtph264depay ! h264parse ! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 ! vtdec ! videoconvert ! video/x-raw,format=RGBA ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
                              )}
                              className={`px-2 py-1.5 rounded text-[8.5px] font-semibold text-center border transition-all truncate ${
                                gstreamerPipeline.includes("vtdec")
                                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                                  : 'bg-zinc-900 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                              }`}
                              title="macOS Hardware Decode (vtdec)"
                            >
                              🍎 macOS Hardware
                            </button>

                            <button
                              type="button"
                              onClick={() => setGstreamerPipeline(
                                "rtspsrc location=rtsp://127.0.0.1:8554/live_stream latency=0 drop-on-latency=true ! rtph264depay ! h264parse ! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 ! vaapih264dec ! videoconvert ! video/x-raw,format=RGBA ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
                              )}
                              className={`px-2 py-1.5 rounded text-[8.5px] font-semibold text-center border transition-all truncate ${
                                gstreamerPipeline.includes("vaapih264dec")
                                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                                  : 'bg-zinc-900 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                              }`}
                              title="Linux VAAPI Hardware Decode (Intel/AMD)"
                            >
                              ⚙️ Linux Hardware
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                // Keep custom/leave as is but focus text area
                              }}
                              className={`px-2 py-1.5 rounded text-[8.5px] font-semibold text-center border transition-all truncate ${
                                !gstreamerPipeline.includes("avdec_h264") && !gstreamerPipeline.includes("vtdec") && !gstreamerPipeline.includes("vaapih264dec")
                                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                                  : 'bg-zinc-900 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                              }`}
                              title="Type/Paste any custom GStreamer pipeline string"
                            >
                              ✍️ Custom Pipeline
                            </button>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[8px] font-extrabold text-zinc-500 uppercase tracking-wide">Edit Active GStreamer Command:</span>
                            <textarea
                              rows={2}
                              value={gstreamerPipeline}
                              onChange={(e) => setGstreamerPipeline(e.target.value)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-[8.5px] font-mono text-emerald-400 focus:outline-none focus:border-zinc-700 leading-normal"
                              placeholder="rtspsrc location=... !"
                            />
                          </div>
                        </div>
                        
                        <div className="bg-zinc-900/40 p-2 rounded border border-zinc-900 leading-normal text-[8.5px] text-zinc-300 space-y-1">
                          <strong className="text-[#f97316]">Prerequisites for Running Receiver:</strong>
                          <pre className="text-[7.5px] font-mono text-emerald-400">
{`# Install GStreamer plugins (including libav for avdec_h264 software decode)
sudo apt install python3-gi python3-gi-cairo gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
# Install python packages (include Pillow/requests for dynamic downsampling)
python3 -m pip install pillow requests`}
                          </pre>
                        </div>

                        <p className="text-[9px] text-zinc-400 leading-normal">
                          Save this code as <code className="text-orange-400 font-mono">gst_rtsp_receiver.py</code> and run with <code className="text-zinc-200 font-mono">python3 gst_rtsp_receiver.py</code>:
                        </p>

                        <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto p-2 bg-black/90 rounded border border-zinc-900 leading-tight select-all">
{`import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
from PIL import Image
import io, requests, sys

# Initialize GStreamer Engine
Gst.init(None)

# Dynamic pipeline injected in real-time from visual UI configuration
pipeline_str = (
    "${gstreamerPipeline.replace(/"/g, '\\"')}"
)

pipeline = Gst.parse_launch(pipeline_str)
appsink = pipeline.get_by_name("sink")

print("==================================================")
print("🚀 GStreamer RTSP Receiver Started!")
print("==================================================")
print("Connecting to: rtsp://127.0.0.1:8554/live_stream")
print("Press Ctrl+C to terminate.")

def on_new_frame(sink):
    sample = sink.emit("pull-sample")
    if not sample:
        return Gst.FlowReturn.OK
        
    buffer = sample.get_buffer()
    caps = sample.get_caps()
    
    # Read actual dynamic stream resolution
    structure = caps.get_structure(0)
    width = structure.get_value("width")
    height = structure.get_value("height")
    
    # Capture GStreamer raw buffer memory
    success, map_info = buffer.map(Gst.MapFlags.READ)
    if success:
        try:
            # Map native RGBA bytes into Pillow
            img = Image.frombuffer("RGBA", (width, height), map_info.data, "raw", "RGBA", 0, 1)
            # Instantly downsample frame to your standard 16x16 matrix layout
            img = img.convert("RGB").resize((16, 16), Image.Resampling.BILINEAR)
            
            # Binary compression optimized for low overhead
            jpg_io = io.BytesIO()
            img.save(jpg_io, format="JPEG", quality=80)
            
            # Post directly to core MJPEG preview runner
            requests.post("http://localhost:3000/api/mjpeg-relay", 
                          data=jpg_io.getvalue(), timeout=0.08)
        except Exception as e:
            pass
        finally:
            buffer.unmap(map_info)
            
    return Gst.FlowReturn.OK

appsink.connect("new-sample", on_new_frame)
pipeline.set_state(Gst.State.PLAYING)

loop = GLib.MainLoop()
try:
    loop.run()
except KeyboardInterrupt:
    print("\\nStopping GStreamer RTSP receiver...")
    pipeline.set_state(Gst.State.NULL)`}
                        </pre>

                        <p className="text-[9px] text-zinc-500 italic">
                          💡 <strong>Zero-Latency Note:</strong> By configuring <code className="text-zinc-300 font-mono">latency=0</code> and setting <code className="text-zinc-300 font-mono">max-buffers=1 drop=true</code> on the appsink, frames that can't be rendered in time are dropped instantly, guaranteeing perfect real-time sync with your screen video loops!
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            </>
            )}
          </div>

          {/* 2. PHYSICAL NETWORK SETTINGS */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'hardware')}
            onDragOver={(e) => handleDivDragOver(e, 'hardware')}
            onDrop={(e) => handleDivDrop(e, 'hardware', 1)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col1Order.indexOf('hardware') !== -1 ? col1Order.indexOf('hardware') : 1 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'hardware' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm transition-all duration-150 ${draggedDivision === 'hardware' ? 'opacity-40' : ''}`}
          >
            <div 
              className="flex items-center justify-between mb-4 cursor-pointer select-none group"
              onClick={() => toggleDivision('hardware')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder section"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5 text-orange-400" />
                  2. Target Hardware Setup
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {collapsedDivisions['hardware'] && (
                  <span className="text-[10px] font-mono text-orange-400 bg-orange-950/50 px-2 py-0.5 rounded border border-orange-900/40 truncate max-w-[170px]">
                    {wledConfig.ipAddress} • {wledConfig.protocol} ({wledConfig.isMatrix ? `${wledConfig.width}x${wledConfig.height}` : `${wledConfig.totalLEDs} LEDs`})
                  </span>
                )}
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['hardware'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['hardware'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['hardware'] && (
              <>
            <div className="space-y-3.5">
              {/* Target IP Block */}
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">WLED IP Address</label>
                <input
                  type="text"
                  value={wledConfig.ipAddress}
                  onChange={(e) => setWledConfig(prev => ({ ...prev, ipAddress: e.target.value }))}
                  className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none focus:border-transparent font-mono"
                  placeholder="e.g. 192.168.1.189"
                />
              </div>

              {/* Transmission Protocol & UDP Port */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Transmission Protocol</label>
                  <select
                    value={wledConfig.protocol}
                    onChange={(e) => handleProtocolChange(e.target.value as SyncProtocol)}
                    className="w-full px-2.5 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-semibold focus:outline-none"
                  >
                    {Object.values(SyncProtocol).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">UDP Port</label>
                  <input
                    type="number"
                    value={wledConfig.port}
                    onChange={(e) => handlePortChange(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Universe Field for DMX Protocols (Art-Net / e131) */}
              {(wledConfig.protocol === SyncProtocol.ARTNET || wledConfig.protocol === SyncProtocol.E131) && (
                <div>
                  <span className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase block">
                      DMX Universe Mapping
                    </label>
                    <span className="text-[9px] text-zinc-500 font-mono">WLED Dev Standard: {wledConfig.protocol === SyncProtocol.E131 ? '1' : '0'}</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="63999"
                    value={wledConfig.universe !== undefined ? wledConfig.universe : (wledConfig.protocol === SyncProtocol.E131 ? 1 : 0)}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, universe: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none focus:border-transparent font-mono"
                  />
                </div>
              )}

              {/* DMX Universe Patch Matrix Trigger Button */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowDmxPatchModal(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg bg-gradient-to-r from-purple-950/60 to-indigo-950/60 border border-purple-500/30 hover:border-purple-500/60 text-purple-200 text-xs font-semibold shadow-sm transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <span>DMX Universe Patch Matrix</span>
                  </span>
                  <span className="text-[10px] font-mono bg-purple-900/60 px-2 py-0.5 rounded text-purple-300 border border-purple-700/50">
                    {dmxPatches.filter(p => p.enabled).length} Active Patches
                  </span>
                </button>
              </div>

              {/* Core Strip vs Matrix Geometry selection */}
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-2">Device Layout Shape</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setWledConfig(prev => ({ ...prev, isMatrix: true }))}
                    className={`p-2.5 rounded border text-xs font-semibold transition-all ${
                      wledConfig.isMatrix
                        ? 'bg-zinc-800/80 border-orange-500/40 text-orange-400 font-bold'
                        : 'bg-zinc-900/50 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    2D LED Matrix Grid
                  </button>
                  <button
                    onClick={() => setWledConfig(prev => ({ ...prev, isMatrix: false }))}
                    className={`p-2.5 rounded border text-xs font-semibold transition-all ${
                      !wledConfig.isMatrix
                        ? 'bg-zinc-800/80 border-orange-500/40 text-orange-400 font-bold'
                        : 'bg-zinc-900/50 border-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    1D LED Ribbon Strip
                  </button>
                </div>
              </div>

              {/* Dynamic properties corresponding to chosen layout */}
              {wledConfig.isMatrix ? (
                <div className="space-y-3 pt-2.5 border-t border-zinc-900">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Matrix Width</span>
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={wledConfig.width}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, width: Math.max(1, Number(e.target.value)) }))}
                        className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Matrix Height</span>
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={wledConfig.height}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, height: Math.max(1, Number(e.target.value)) }))}
                        className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono"
                      />
                    </div>
                  </div>

                  {/* Wire routing layout options */}
                  <div className="space-y-1 mt-2 bg-zinc-950 p-2.5 rounded border border-zinc-900">
                    <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wide block mb-1.5">Matrix Wiring Routing</span>
                    
                    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none py-1 block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wledConfig.serpentine}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, serpentine: e.target.checked }))}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Serpentine Layout (Zig-Zag)
                    </label>

                    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none py-1 block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wledConfig.reverseRows}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, reverseRows: e.target.checked }))}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Reverse Rows / Layout Direction
                    </label>

                    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none py-1 block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wledConfig.vertical}
                        onChange={(e) => setWledConfig(prev => ({ ...prev, vertical: e.target.checked }))}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800"
                      />
                      Vertical Routing Scan (Columns first)
                    </label>
                  </div>
                </div>
              ) : (
                <div className="pt-2.5 border-t border-zinc-900">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Total LED Count Cascade</span>
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={wledConfig.totalLEDs}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, totalLEDs: Math.max(1, Number(e.target.value)) }))}
                    className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono"
                  />
                  <span className="text-[9px] text-zinc-500 leading-normal mt-1 block">
                    Frames are compressed horizontally onto a single row sequence of this exact length.
                  </span>
                </div>
              )}

              {/* Main Panel Cropping Coordinates */}
              <div className="bg-zinc-950/40 p-3 rounded-lg border border-zinc-900/60 mt-3 space-y-2.5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Main Panel Coordinates</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      id="main-custom-coords"
                      checked={!!wledConfig.customMappingEnabled}
                      onChange={(e) => setWledConfig(prev => ({
                        ...prev,
                        customMappingEnabled: e.target.checked,
                        customX: prev.customX ?? 50,
                        customY: prev.customY ?? 50,
                        customWidth: prev.customWidth ?? 60,
                        customHeight: prev.customHeight ?? 60
                      }))}
                      className="rounded accent-orange-500 bg-zinc-950 border-zinc-800 cursor-pointer w-3.5 h-3.5"
                    />
                    <label htmlFor="main-custom-coords" className="text-[9.5px] font-semibold text-zinc-300 cursor-pointer select-none">
                      Enable Cropping / Sub-Region
                    </label>
                  </div>
                </div>

                {wledConfig.customMappingEnabled && (
                  <div className="space-y-2 text-zinc-300">
                    <p className="text-[9.5px] text-zinc-500 leading-normal">
                      Drag or stretch the orange bounding box in the <strong>Local Layout Preview</strong> to choose the region of interest for this Main WLED Matrix.
                    </p>
                    
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[8px] text-zinc-500 font-mono">
                        <span>Center X: {wledConfig.customX ?? 50}%</span>
                        <span>Center Y: {wledConfig.customY ?? 50}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={wledConfig.customX ?? 50}
                          onChange={(e) => setWledConfig(prev => ({ ...prev, customX: Number(e.target.value) }))}
                          className="w-full accent-orange-500 h-1 bg-zinc-950 rounded cursor-pointer"
                        />
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={wledConfig.customY ?? 50}
                          onChange={(e) => setWledConfig(prev => ({ ...prev, customY: Number(e.target.value) }))}
                          className="w-full accent-orange-500 h-1 bg-zinc-950 rounded cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="space-y-1 border-t border-zinc-900/60 pt-1.5">
                      <div className="flex items-center justify-between text-[8px] text-zinc-500 font-mono">
                        <span>Crop Width: {wledConfig.customWidth ?? 60}%</span>
                        <span>Crop Height: {wledConfig.customHeight ?? 60}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="range"
                          min="2"
                          max="100"
                          value={wledConfig.customWidth ?? 60}
                          onChange={(e) => setWledConfig(prev => ({ ...prev, customWidth: Number(e.target.value) }))}
                          className="w-full accent-orange-500 h-1 bg-zinc-950 rounded cursor-pointer"
                        />
                        <input
                          type="range"
                          min="2"
                          max="100"
                          value={wledConfig.customHeight ?? 60}
                          onChange={(e) => setWledConfig(prev => ({ ...prev, customHeight: Number(e.target.value) }))}
                          className="w-full accent-orange-500 h-1 bg-zinc-950 rounded cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </>
            )}
          </div>

          {/* 3. MULTI-OUTPUT ROUTER PANEL */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'aux')}
            onDragOver={(e) => handleDivDragOver(e, 'aux')}
            onDrop={(e) => handleDivDrop(e, 'aux', 1)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col1Order.indexOf('aux') !== -1 ? col1Order.indexOf('aux') : 2 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'aux' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm transition-all duration-150 ${draggedDivision === 'aux' ? 'opacity-40' : ''}`}
          >
            <div 
              className="flex items-center justify-between mb-3.5 cursor-pointer select-none group"
              onClick={() => toggleDivision('aux')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder section"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-orange-400" />
                    3. Multi-Output Router
                  </h2>
                  <p className="text-[10px] text-zinc-500">Route pixels to secondary controllers in real-time</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {collapsedDivisions['aux'] && (
                  <span className="text-[10px] font-mono text-purple-400 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-900/40">
                    {auxiliaryTargets.filter(t => t.enabled).length} Active Targets
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleAddAux(); }}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-semibold transition"
                >
                  <Plus className="w-3 h-3" /> Add Light
                </button>
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['aux'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['aux'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['aux'] && (
              <>
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
              {auxiliaryTargets.map((target) => (
                <div key={target.id} className="p-3 bg-zinc-950 rounded-lg border border-zinc-900 space-y-3 relative group/item">
                  
                  {/* Target Top Control Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 mr-2">
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={() => handleToggleAux(target.id)}
                        className="rounded accent-orange-500 bg-zinc-900 border-zinc-800 cursor-pointer"
                        title="Toggle Target stream broadcast"
                      />
                      
                      {target.type === TargetType.AMBIENT_LIGHTPACK ? (
                        <Tv className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      ) : (
                        <Lightbulb className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      )}

                      <input
                        type="text"
                        value={target.name}
                        onChange={(e) => handleUpdateAux(target.id, { name: e.target.value })}
                        className="bg-transparent border-b border-transparent hover:border-zinc-800 focus:border-orange-500 focus:outline-none text-xs font-semibold text-zinc-200 py-0.5 w-full transition"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold leading-none ${
                        target.enabled 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 animate-pulse'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {target.enabled ? 'ACTIVE' : 'MUTED'}
                      </span>
                      
                      <button
                        onClick={() => handleRemoveAux(target.id)}
                        className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100"
                        title="Remove Target"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Expand configuration list */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs pt-2 border-t border-zinc-900/40">
                    {/* IP Field */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">IP Address</span>
                      <input
                        type="text"
                        value={target.ipAddress}
                        onChange={(e) => handleUpdateAux(target.id, { ipAddress: e.target.value })}
                        className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    {/* Protocol Selector */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Protocol</span>
                      <select
                        value={target.protocol}
                        onChange={(e) => {
                          const proto = e.target.value as SyncProtocol;
                          let port = 21324;
                          if (proto === SyncProtocol.DDP) port = 4048;
                          if (proto === SyncProtocol.E131) port = 5568;
                          if (proto === SyncProtocol.ARTNET) port = 6454;
                          const universe = proto === SyncProtocol.E131 ? 1 : 0;
                          handleUpdateAux(target.id, { protocol: proto, port, universe });
                        }}
                        className="w-full px-1.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] focus:outline-none"
                      >
                        {Object.values(SyncProtocol).map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>

                    {/* Port Field */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Port</span>
                      <input
                        type="number"
                        value={target.port}
                        onChange={(e) => handleUpdateAux(target.id, { port: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    {/* Universe Field */}
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Universe</span>
                      <input
                        type="number"
                        min="0"
                        max="63999"
                        disabled={target.protocol !== SyncProtocol.ARTNET && target.protocol !== SyncProtocol.E131}
                        value={target.universe !== undefined ? target.universe : (target.protocol === SyncProtocol.E131 ? 1 : 0)}
                        onChange={(e) => handleUpdateAux(target.id, { universe: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-orange-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        placeholder="N/A"
                      />
                    </div>
                  </div>

                  {/* Geometry specific sub-sections */}
                  {target.type === TargetType.AMBIENT_LIGHTPACK ? (
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-900/80 space-y-2">
                      <span className="text-[8px] font-extrabold text-zinc-400 uppercase tracking-wider block">LCD Border segment LED Counts</span>
                      <div className="grid grid-cols-4 gap-1">
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Top</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.topLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { topLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Right</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.rightLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { rightLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Bottom</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.bottomLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { bottomLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                        <div>
                          <span className="text-[7.5px] font-bold text-zinc-500 text-center block mb-0.5">Left</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={target.leftLedCount}
                            onChange={(e) => handleUpdateAux(target.id, { leftLedCount: Math.max(0, Number(e.target.value)) })}
                            className="w-full p-1 bg-zinc-950 border border-zinc-800 text-center rounded text-[10px] font-mono text-zinc-200"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-zinc-900/60 p-2.5 rounded border border-zinc-900/80 space-y-2">
                      <div className="flex items-center justify-between border-b border-zinc-800/50 pb-1.5 mb-1.5">
                        <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">Spot Spotlight Mapping</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            id={`custom-map-${target.id}`}
                            checked={!!target.customMappingEnabled}
                            onChange={(e) => handleUpdateAux(target.id, { 
                              customMappingEnabled: e.target.checked,
                              customX: target.customX ?? 50,
                              customY: target.customY ?? 50,
                              customMappingType: target.customMappingType ?? 'average',
                              customWidth: target.customWidth ?? 20,
                              customHeight: target.customHeight ?? 20
                            })}
                            className="rounded accent-emerald-500 bg-zinc-950 border-zinc-800 cursor-pointer w-3 h-3"
                          />
                          <label htmlFor={`custom-map-${target.id}`} className="text-[8.5px] font-semibold text-zinc-300 cursor-pointer select-none">
                            Precise Coordinates
                          </label>
                        </div>
                      </div>

                      {!target.customMappingEnabled ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Mapping Source Zone</span>
                            <select
                              value={target.mappedZone}
                              onChange={(e) => handleUpdateAux(target.id, { mappedZone: e.target.value as AccentMappingZone })}
                              className="w-full px-1 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 text-[10px] focus:outline-none"
                            >
                              {Object.values(AccentMappingZone).map(z => (
                                <option key={z} value={z}>{z}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Glow LED Count</span>
                            <input
                              type="number"
                              min="1"
                              max="300"
                              value={target.accentLedCount}
                              onChange={(e) => handleUpdateAux(target.id, { accentLedCount: Math.max(1, Number(e.target.value)) })}
                              className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-[10px] font-mono text-zinc-200"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 text-zinc-300">
                          {/* Sample Style */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Sample Style</span>
                              <select
                                value={target.customMappingType ?? 'average'}
                                onChange={(e) => handleUpdateAux(target.id, { customMappingType: e.target.value as 'single' | 'average' })}
                                className="w-full px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 text-[9px] focus:outline-none"
                              >
                                <option value="single">🎯 Single Pixel</option>
                                <option value="average">🧱 Area Average</option>
                              </select>
                            </div>
                            <div>
                              <span className="text-[8px] font-bold text-zinc-500 uppercase block mb-0.5">Glow LED Count</span>
                              <input
                                type="number"
                                min="1"
                                max="300"
                                value={target.accentLedCount}
                                onChange={(e) => handleUpdateAux(target.id, { accentLedCount: Math.max(1, Number(e.target.value)) })}
                                className="w-full px-1.5 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-[9px] font-mono text-zinc-200"
                              />
                            </div>
                          </div>

                          {/* Coordinates */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[8px] text-zinc-400 font-mono">
                              <span>Position X: {(target.customX ?? 50)}%</span>
                              <span>Position Y: {(target.customY ?? 50)}%</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={target.customX ?? 50}
                                onChange={(e) => handleUpdateAux(target.id, { customX: Number(e.target.value) })}
                                className="w-full accent-emerald-500 h-1 bg-zinc-950 rounded cursor-pointer"
                              />
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={target.customY ?? 50}
                                onChange={(e) => handleUpdateAux(target.id, { customY: Number(e.target.value) })}
                                className="w-full accent-emerald-500 h-1 bg-zinc-950 rounded cursor-pointer"
                              />
                            </div>
                          </div>

                          {/* Area Sizing if average is active */}
                          {(target.customMappingType ?? 'average') === 'average' && (
                            <div className="space-y-1 border-t border-zinc-900/60 pt-1.5">
                              <div className="flex items-center justify-between text-[8px] text-zinc-400 font-mono">
                                <span>Zone Width: {(target.customWidth ?? 20)}%</span>
                                <span>Zone Height: {(target.customHeight ?? 20)}%</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="range"
                                  min="2"
                                  max="100"
                                  value={target.customWidth ?? 20}
                                  onChange={(e) => handleUpdateAux(target.id, { customWidth: Number(e.target.value) })}
                                  className="w-full accent-emerald-500 h-1 bg-zinc-950 rounded cursor-pointer"
                                />
                                <input
                                  type="range"
                                  min="2"
                                  max="100"
                                  value={target.customHeight ?? 20}
                                  onChange={(e) => handleUpdateAux(target.id, { customHeight: Number(e.target.value) })}
                                  className="w-full accent-emerald-500 h-1 bg-zinc-950 rounded cursor-pointer"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              ))}

              {auxiliaryTargets.length === 0 && (
                <div className="py-6 text-center text-zinc-500 text-[11px] leading-normal border border-dashed border-zinc-800 rounded-lg">
                  No auxiliary Outputs configured.<br />
                  Click <strong>Add Light</strong> up top to link a desk spotlights or cabinet lamps!
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </section>


        {/* CENTER COLUMN PANEL: AUDIO & EMULATOR (Col width: 5) */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          
          {/* CAMERA/VIDEO CAPTURE SOURCE ELEMENTS (Kept active & visible to browser layout to prevent GPU throttling/black screen issues, but transparent to user) */}
          <div 
            className="absolute bottom-4 right-4 pointer-events-none select-none z-[-10] overflow-hidden rounded border border-zinc-900/40 bg-black/10" 
            style={{ width: '160px', height: '90px', opacity: 0.015 }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              crossOrigin="anonymous"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="w-full h-full object-cover"
            />
            {/* Real downsampling Canvas */}
            <canvas ref={processingCanvasRef} />
            {/* Raw matrix indicator */}
            <canvas ref={rawPreviewCanvasRef} />
          </div>

          {/* REALTIME VISUAL FEED PANEL */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'preview')}
            onDragOver={(e) => handleDivDragOver(e, 'preview')}
            onDrop={(e) => handleDivDrop(e, 'preview', 2)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col2Order.indexOf('preview') !== -1 ? col2Order.indexOf('preview') : 0 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'preview' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm flex flex-col justify-between transition-all duration-150 ${draggedDivision === 'preview' ? 'opacity-40' : ''}`}
          >
            <div 
              className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4 cursor-pointer select-none group"
              onClick={() => toggleDivision('preview')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder section"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">Local Layout Preview</h3>
                  <p className="text-xs text-zinc-400">Low-resolution matrix mappings showing individual address segments</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400 leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                  Canvas Feed
                </div>
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['preview'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['preview'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['preview'] && (
              <>
            {/* Video preview / procedural render layout */}
            <div className="bg-zinc-950 rounded-lg p-5 flex flex-col items-center justify-center border border-zinc-800/50 min-h-[220px]">
              <div className="flex flex-wrap items-center justify-center gap-1.5 mb-4 bg-zinc-900/40 p-1 rounded-lg border border-zinc-900/60 w-full max-w-[420px]">
                <span className="text-[9px] text-zinc-500 font-extrabold uppercase tracking-wider px-1.5 select-none">Overlays:</span>
                <button
                  type="button"
                  onClick={() => setShowMainPanelOverlay(!showMainPanelOverlay)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold border transition-all ${
                    showMainPanelOverlay 
                      ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 font-extrabold' 
                      : 'bg-zinc-950 text-zinc-500 border-zinc-800/40 hover:text-zinc-300'
                  }`}
                  title="Toggle visual bounds & drag/stretch controls for Main Panel"
                >
                  <Grid className="w-3 h-3" />
                  Main Panel {showMainPanelOverlay && wledConfig.customMappingEnabled && <span className="text-[7.5px] bg-orange-500 text-black px-1 rounded-sm uppercase tracking-wider font-black scale-90">Edit</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAmbilightOverlay(!showAmbilightOverlay)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold border transition-all ${
                    showAmbilightOverlay 
                      ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' 
                      : 'bg-zinc-950 text-zinc-500 border-zinc-800/40 hover:text-zinc-300'
                  }`}
                  title="Toggle visual bounds for Ambilight Backlights"
                >
                  <Tv className="w-3 h-3" />
                  Ambilight
                </button>
                <button
                  type="button"
                  onClick={() => setShowSpotlampsOverlay(!showSpotlampsOverlay)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold border transition-all ${
                    showSpotlampsOverlay 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-extrabold' 
                      : 'bg-zinc-950 text-zinc-500 border-zinc-800/40 hover:text-zinc-300'
                  }`}
                  title="Toggle visual bounds & drag/stretch controls for Spotlamps"
                >
                  <Lightbulb className="w-3 h-3" />
                  Spotlamps {showSpotlampsOverlay && <span className="text-[7.5px] bg-emerald-500 text-black px-1 rounded-sm uppercase tracking-wider font-black scale-90">Edit</span>}
                </button>
              </div>
 
              {/* Wrapped Canvas and Draggable Layout Grid */}
              <div 
                ref={previewContainerRef}
                className="relative border border-zinc-700/40 rounded overflow-hidden shadow-inner p-1 bg-black select-none w-full"
                style={{
                  maxWidth: wledConfig.isMatrix ? `${Math.min(wledConfig.width * 28, 420)}px` : '420px',
                  aspectRatio: wledConfig.isMatrix ? `${wledConfig.width}/${wledConfig.height}` : '16/2'
                }}
              >
                <canvas
                  ref={previewCanvasRef}
                  className="w-full h-full rounded bg-zinc-900/40 block"
                  style={{
                    imageRendering: 'pixelated',
                  }}
                />
 
                {/* Draggable and stretchable HTML overlay container */}
                <div className="absolute inset-1 pointer-events-none select-none z-10 overflow-hidden">
                  {/* Main Panel Crop Overlay Box */}
                  {showMainPanelOverlay && wledConfig.customMappingEnabled && (() => {
                    const cx = wledConfig.customX ?? 50;
                    const cy = wledConfig.customY ?? 50;
                    const cw = wledConfig.customWidth ?? 60;
                    const ch = wledConfig.customHeight ?? 60;

                    const style: React.CSSProperties = {
                      left: `${cx - cw / 2}%`,
                      top: `${cy - ch / 2}%`,
                      width: `${cw}%`,
                      height: `${ch}%`,
                    };

                    return (
                      <div
                        style={style}
                        className="absolute border border-orange-500 bg-orange-500/15 pointer-events-auto cursor-move hover:border-orange-400 hover:bg-orange-500/25 active:border-orange-400 ring-1 ring-orange-500/30 flex flex-col justify-between p-0.5 select-none"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          handlePointerDown(e, 'MAIN_PANEL', 'move');
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      >
                        {/* Box label indicator */}
                        <div className="flex items-center justify-between pointer-events-none select-none">
                          <span className="text-[8px] px-1 py-0.5 rounded font-extrabold text-white bg-black/85 leading-none border border-orange-500/30 text-orange-400">
                            📺 Main WLED Panel ({wledConfig.width}x{wledConfig.height})
                          </span>
                        </div>

                        {/* Interactive drag/stretch handle at bottom right */}
                        <div
                          className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-orange-500 hover:bg-orange-400 text-black border border-white flex items-center justify-center rounded-tl cursor-se-resize shadow-md transition-transform active:scale-90"
                          style={{ pointerEvents: 'auto' }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handlePointerDown(e, 'MAIN_PANEL', 'resize');
                          }}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                        >
                          <svg className="w-2.5 h-2.5 text-black pointer-events-none" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M2 8l6-6M4 2h4v4" />
                          </svg>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Ambilight Edge Indicators */}
                  {showAmbilightOverlay && auxiliaryTargets.filter(t => t.enabled && t.type === TargetType.AMBIENT_LIGHTPACK).map((target) => (
                    <div key={target.id} className="absolute inset-0 border-2 border-dashed border-sky-400/50 rounded pointer-events-none">
                      {/* Top segment dots */}
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-sky-500/15 flex justify-around items-center">
                        {Array.from({ length: Math.min(12, target.topLedCount) }).map((_, i) => (
                          <div key={i} className="w-1 h-1 bg-sky-300 rounded-full" />
                        ))}
                      </div>
                      {/* Right segment dots */}
                      <div className="absolute top-0 bottom-0 right-0 w-1.5 bg-sky-500/15 flex flex-col justify-around items-center">
                        {Array.from({ length: Math.min(10, target.rightLedCount) }).map((_, i) => (
                          <div key={i} className="w-1 h-1 bg-sky-300 rounded-full" />
                        ))}
                      </div>
                      {/* Bottom segment dots */}
                      <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-sky-500/15 flex justify-around items-center">
                        {Array.from({ length: Math.min(12, target.bottomLedCount) }).map((_, i) => (
                          <div key={i} className="w-1 h-1 bg-sky-300 rounded-full" />
                        ))}
                      </div>
                      {/* Left segment dots */}
                      <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-sky-500/15 flex flex-col justify-around items-center">
                        {Array.from({ length: Math.min(10, target.leftLedCount) }).map((_, i) => (
                          <div key={i} className="w-1 h-1 bg-sky-300 rounded-full" />
                        ))}
                      </div>
                      {/* Edge Label */}
                      <span className="absolute top-1.5 left-2 text-[8px] text-sky-300 bg-black/90 px-1 py-0.5 rounded border border-sky-500/20 font-mono font-bold leading-none">
                        📺 {target.name}
                      </span>
                    </div>
                  ))}

                  {/* Spotlamp Selection boxes */}
                  {showSpotlampsOverlay && auxiliaryTargets.filter(t => t.enabled && t.type === TargetType.INDIVIDUAL_ACCENT).map((target) => {
                    const isCustom = !!target.customMappingEnabled;
                    
                    let style: React.CSSProperties = {};
                    if (isCustom) {
                      const cx = target.customX ?? 50;
                      const cy = target.customY ?? 50;
                      const type = target.customMappingType ?? 'average';
                      
                      const cellWidth = 100 / (wledConfig.matrixWidth || 16);
                      const cellHeight = 100 / (wledConfig.matrixHeight || 16);
                      
                      const bw = type === 'single' ? cellWidth : (target.customWidth ?? 20);
                      const bh = type === 'single' ? cellHeight : (target.customHeight ?? 20);

                      style = {
                        left: `${cx - bw / 2}%`,
                        top: `${cy - bh / 2}%`,
                        width: `${bw}%`,
                        height: `${bh}%`,
                      };
                    } else {
                      const zone = target.mappedZone;
                      switch (zone) {
                        case AccentMappingZone.CENTER:
                          style = { left: '25%', top: '25%', width: '50%', height: '50%' };
                          break;
                        case AccentMappingZone.TOP:
                          style = { left: '0%', top: '0%', width: '100%', height: '16.6%' };
                          break;
                        case AccentMappingZone.BOTTOM:
                          style = { left: '0%', top: '83.4%', width: '100%', height: '16.6%' };
                          break;
                        case AccentMappingZone.LEFT:
                          style = { left: '0%', top: '0%', width: '16.6%', height: '100%' };
                          break;
                        case AccentMappingZone.RIGHT:
                          style = { left: '83.4%', top: '0%', width: '16.6%', height: '100%' };
                          break;
                        case AccentMappingZone.WHOLE_AVERAGE:
                        default:
                          style = { left: '0%', top: '0%', width: '100%', height: '100%' };
                          break;
                      }
                    }

                    return (
                      <div
                        key={target.id}
                        style={style}
                        className={`absolute border flex flex-col justify-between p-0.5 select-none transition-shadow ${
                          isCustom 
                            ? 'border-emerald-400 bg-emerald-400/15 pointer-events-auto cursor-move hover:border-emerald-300 hover:bg-emerald-400/25 active:border-emerald-300 ring-1 ring-emerald-400/30' 
                            : 'border-orange-500/60 bg-orange-500/5 pointer-events-none'
                        }`}
                        onPointerDown={(e) => {
                          if (!isCustom) return;
                          e.stopPropagation();
                          handlePointerDown(e, target, 'move');
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      >
                        {/* Box label indicator */}
                        <div className="flex items-center justify-between pointer-events-none select-none">
                          <span className={`text-[8px] px-1 py-0.5 rounded font-extrabold text-white bg-black/85 leading-none border ${
                            isCustom ? 'border-emerald-500/30 text-emerald-300' : 'border-orange-500/20 text-orange-400'
                          }`}>
                            💡 {target.name} {isCustom && `(${target.customMappingType === 'single' ? 'Pixel' : 'Area'})`}
                          </span>
                        </div>

                        {/* Interactive drag/stretch handles */}
                        {isCustom && target.customMappingType === 'average' && (
                          <div
                            className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 hover:bg-emerald-400 text-black border border-white flex items-center justify-center rounded-tl cursor-se-resize shadow-md transition-transform active:scale-90"
                            style={{ pointerEvents: 'auto' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              handlePointerDown(e, target, 'resize');
                            }}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                          >
                            <svg className="w-2.5 h-2.5 text-black pointer-events-none" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M2 8l6-6M4 2h4v4" />
                            </svg>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {activeSource !== SourceType.E_EFFECTS && (
                <div className="flex items-center gap-2 mt-4 select-none">
                  <button
                    onClick={togglePlayPause}
                    className="p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <span className="text-[10px] font-mono text-zinc-400">
                    Source: {isPlaying ? 'Acquiring active frames' : 'Stream idle'}
                  </span>
                </div>
              )}
              {activeSource === SourceType.E_EFFECTS && (
                <div className="text-[10px] font-mono text-purple-400 mt-4 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded">
                  Rendering procedural generator: {activeEffect}
                </div>
              )}
            </div>
            </>
            )}
          </div>

          {/* ACTIVE HARDWARE EMULATOR */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'emulator')}
            onDragOver={(e) => handleDivDragOver(e, 'emulator')}
            onDrop={(e) => handleDivDrop(e, 'emulator', 2)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col2Order.indexOf('emulator') !== -1 ? col2Order.indexOf('emulator') : 1 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'emulator' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm flex-1 transition-all duration-150 ${draggedDivision === 'emulator' ? 'opacity-40' : ''}`}
          >
            <div 
              className="flex items-center justify-between mb-4 cursor-pointer select-none group border-b border-zinc-850 pb-3"
              onClick={() => toggleDivision('emulator')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder section"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Grid className="w-4 h-4 text-orange-400" />
                  WLED Virtual Matrix & Spot Emulators
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {collapsedDivisions['emulator'] && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-900/40">
                    Active Emulator
                  </span>
                )}
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['emulator'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['emulator'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['emulator'] && (
              <WLEDEmulator
                pixels={simulatedPixels}
                config={wledConfig}
                auxTargets={auxiliaryTargets}
                auxPixels={auxPixels}
              />
            )}
          </div>
        </section>


        {/* RIGHT COLUMN PANEL: POST PROCESS CONTROLS & TELEMETRY (Col width: 3) */}
        <section className="lg:col-span-3 flex flex-col gap-6">
          
          {/* 3. IMAGE ADJUSTMENTS PANEL */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'calibration')}
            onDragOver={(e) => handleDivDragOver(e, 'calibration')}
            onDrop={(e) => handleDivDrop(e, 'calibration', 3)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col3Order.indexOf('calibration') !== -1 ? col3Order.indexOf('calibration') : 0 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'calibration' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm transition-all duration-150 ${draggedDivision === 'calibration' ? 'opacity-40 scale-[0.99]' : ''}`}
          >
            <div 
              className="flex items-center justify-between mb-4 cursor-pointer select-none group"
              onClick={() => toggleDivision('calibration')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder card"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-orange-400" />
                  3. Image Calibration
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {collapsedDivisions['calibration'] && (
                  <span className="text-[10px] font-mono text-orange-400 bg-orange-950/50 px-2 py-0.5 rounded border border-orange-900/40">
                    Bri: {wledConfig.brightness}% • {wledConfig.fpsLimit} FPS
                  </span>
                )}
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['calibration'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['calibration'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['calibration'] && (
              <div className="space-y-4">
                {/* Brightness slider */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-zinc-300">Brightness</span>
                    <span className="font-mono text-orange-400 font-medium">{wledConfig.brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="150"
                    value={wledConfig.brightness}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, brightness: Number(e.target.value) }))}
                    className="w-full accent-orange-500 bg-zinc-900"
                  />
                </div>

                {/* Contrast slider */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-zinc-300">Contrast</span>
                    <span className="font-mono text-orange-400 font-medium">{wledConfig.contrast > 0 ? `+${wledConfig.contrast}` : wledConfig.contrast}%</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    value={wledConfig.contrast}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, contrast: Number(e.target.value) }))}
                    className="w-full accent-orange-500 bg-zinc-900"
                  />
                </div>

                {/* Saturation slider */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-zinc-300">Saturation</span>
                    <span className="font-mono text-orange-400 font-medium">{wledConfig.saturation > 0 ? `+${wledConfig.saturation}` : wledConfig.saturation}%</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    value={wledConfig.saturation}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, saturation: Number(e.target.value) }))}
                    className="w-full accent-orange-500 bg-zinc-900"
                  />
                </div>

                {/* Blur slider */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-zinc-300">Spatial Smooth (Blur)</span>
                    <span className="font-mono text-orange-400 font-medium">{wledConfig.blur}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={wledConfig.blur}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, blur: Number(e.target.value) }))}
                    className="w-full accent-orange-500 bg-zinc-900"
                  />
                  <span className="text-[8.5px] text-zinc-500 mt-1 block">Smooths color edges so discrete LEDs blend softly.</span>
                </div>

                {/* FPS slider */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-zinc-300">Frame Rate Limit</span>
                    <span className="font-mono text-orange-400 font-medium">{wledConfig.fpsLimit} FPS</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={wledConfig.fpsLimit}
                    onChange={(e) => setWledConfig(prev => ({ ...prev, fpsLimit: Number(e.target.value) }))}
                    className="w-full accent-orange-500 bg-zinc-900"
                  />
                </div>
              </div>
            )}
          </div>

          {/* TELEMETRY PANEL */}
          <div 
            draggable={true}
            onDragStart={(e) => handleDivDragStart(e, 'telemetry')}
            onDragOver={(e) => handleDivDragOver(e, 'telemetry')}
            onDrop={(e) => handleDivDrop(e, 'telemetry', 3)}
            onDragEnd={() => { setDraggedDivision(null); setDragOverDivision(null); }}
            style={{ order: col3Order.indexOf('telemetry') !== -1 ? col3Order.indexOf('telemetry') : 1 }}
            className={`bg-[#121214] rounded-xl border ${
              dragOverDivision === 'telemetry' ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-zinc-900'
            } p-5 shadow-sm flex-1 transition-all duration-150 ${draggedDivision === 'telemetry' ? 'opacity-40 scale-[0.99]' : ''}`}
          >
            <div 
              className="flex items-center justify-between mb-4 cursor-pointer select-none group"
              onClick={() => toggleDivision('telemetry')}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800/60 transition"
                  title="Drag to reorder card"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-orange-400" />
                  Live Telemetry
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {collapsedDivisions['telemetry'] && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-900/40">
                    {stats.fps} FPS • {(stats.bytesSent / 1024).toFixed(0)} KB/s
                  </span>
                )}
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition"
                  aria-label={collapsedDivisions['telemetry'] ? 'Expand' : 'Collapse'}
                >
                  {collapsedDivisions['telemetry'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!collapsedDivisions['telemetry'] && (
              <div className="grid grid-cols-1 gap-3 font-mono text-xs">
                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                  <span className="text-zinc-500 font-medium">Output frame rate</span>
                  <span className="text-zinc-200 font-semibold">{stats.fps} fps</span>
                </div>
                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                  <span className="text-zinc-500 font-medium">Data bandwidth</span>
                  <span className="text-zinc-200 font-semibold">{(stats.bytesSent / 1024).toFixed(1)} KB/s</span>
                </div>
                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                  <span className="text-zinc-500 font-medium">Packets broadcast</span>
                  <span className="text-zinc-200 font-semibold">{stats.packetsSent} pkt/s</span>
                </div>
                {rustEngineStatus.connected && (
                  <div className="p-2.5 rounded bg-cyan-950/40 border border-cyan-800/40 flex justify-between">
                    <span className="text-cyan-400 font-medium text-[10px] flex items-center gap-1">
                      <Zap className="w-3 h-3 text-cyan-400" /> Rust Frame Calc Time
                    </span>
                    <span className="text-cyan-300 font-semibold text-[10px]">{stats.renderTimeUs || 180} µs</span>
                  </div>
                )}
                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-900 flex justify-between">
                  <span className="text-zinc-400 font-medium text-[10px]">Server UDP Latency</span>
                  <span className="text-zinc-500 font-semibold text-[10px]">{stats.latencyMs}ms</span>
                </div>
              </div>
            )}
          </div>

        </section>

      </main>

      {/* FOOTER ACCENTS */}
      <footer className="border-t border-zinc-900 p-4 text-center mt-auto bg-[#09090b] flex items-center justify-between px-8">
        <p className="text-[10px] text-zinc-500">
          Created according to the zak-45/WLEDVideoSync specification. Ultra-low-latency Linux Wayland & OMT Core in Rust.
        </p>
        <button
          onClick={() => setShowRustModal(true)}
          className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1.5 transition"
        >
          <Terminal className="w-3 h-3" />
          <span>Rust Engine Instructions & Systemd</span>
        </button>
      </footer>

      {/* RUST ENGINE SETUP MODAL */}
      {showRustModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#121214] border border-cyan-500/30 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">Rust Core Video Sync Engine</h3>
                  <p className="text-[11px] text-zinc-400">Ultra-low-latency Linux Wayland, OMT & Raspberry Pi 4 backend</p>
                </div>
              </div>
              <button
                onClick={() => setShowRustModal(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            {/* Tab switch: Linux Desktop vs Raspberry Pi 4 */}
            <div className="flex border-b border-zinc-800 text-xs">
              <button
                type="button"
                onClick={() => setRustModalTab('linux')}
                className={`px-4 py-2 font-semibold border-b-2 transition cursor-pointer ${
                  rustModalTab === 'linux'
                    ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Linux / Desktop Wayland
              </button>
              <button
                type="button"
                onClick={() => setRustModalTab('pi')}
                className={`px-4 py-2 font-semibold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                  rustModalTab === 'pi'
                    ? 'border-red-500 text-red-400 bg-red-500/10'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>🍓 Raspberry Pi 4 (Headless)</span>
              </button>
            </div>

            {rustModalTab === 'linux' ? (
              <div className="space-y-3 text-xs text-zinc-300">
                <div className="bg-cyan-950/30 border border-cyan-800/40 rounded-lg p-3 text-[11px] space-y-1">
                  <span className="font-semibold text-cyan-400 block">⚡ Why Rust for High-Density Lighting?</span>
                  <p className="text-zinc-400 leading-relaxed text-[10.5px]">
                    When scaling to thousands of LEDs across multiple DMX universes, JavaScript garbage collection pauses cause stutter. The Rust engine provides sub-millisecond frame processing, Rayon multithreading, zero-copy Wayland PipeWire capture (DMA-BUF), and asynchronous UDP broadcast.
                  </p>
                </div>

                <div>
                  <span className="font-bold text-zinc-400 uppercase text-[10px] tracking-wider block mb-1.5">1. Install Prerequisites (Linux Wayland):</span>
                  <pre className="bg-black/80 p-2.5 rounded border border-zinc-800 text-[10px] font-mono text-emerald-400 select-all overflow-x-auto">
{`# Ubuntu / Debian / Pop!_OS
sudo apt update && sudo apt install -y build-essential pkg-config libclang-dev libpipewire-0.3-dev libspa-0.2-dev

# Fedora
sudo dnf install -y gcc clang-devel pipewire-devel dbus-devel

# Arch Linux
sudo pacman -S base-devel clang pipewire`}
                  </pre>
                </div>

                <div>
                  <span className="font-bold text-zinc-400 uppercase text-[10px] tracking-wider block mb-1.5">2. Compile & Run the Engine:</span>
                  <pre className="bg-black/80 p-2.5 rounded border border-zinc-800 text-[10px] font-mono text-cyan-400 select-all overflow-x-auto">
{`cd rust-engine

# Build with native Wayland PipeWire DMA-BUF:
cargo build --release --features wayland-pipewire

# Run the native daemon:
./target/release/wled-video-sync-rust`}
                  </pre>
                </div>

                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850 space-y-1.5 text-[10.5px]">
                  <div className="flex items-center gap-1.5 font-bold text-orange-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    OMT (Open Media Transport) & PipeWire Features:
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                    <li><strong>mDNS Auto-Discovery:</strong> Automatically browses local subnet for <code className="text-zinc-200 font-mono">_omt._tcp.local</code> feeds.</li>
                    <li><strong>VMX Codec:</strong> Decodes sub-frame latency 4:2:2 video streams from vMix, OBS, and Open Camera.</li>
                    <li><strong>Multi-Universe DMX Slicing:</strong> Chunks high-density LED matrices across consecutive Art-Net 4 & sACN E1.31 universes automatically.</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5 text-xs text-zinc-300">
                <div className="bg-red-950/25 border border-red-800/40 rounded-lg p-3 text-[11px] space-y-1">
                  <span className="font-semibold text-red-400 block flex items-center gap-1.5">
                    🍓 Automated Raspberry Pi 4 Setup Script
                  </span>
                  <p className="text-zinc-400 leading-relaxed text-[10.5px]">
                    To set up your Raspberry Pi 4 Model B as a dedicated headless receiver (auto-booting on power-on with zero-copy UDP transmission), execute the setup script below directly on your Pi.
                  </p>
                </div>

                <div>
                  <span className="font-bold text-zinc-400 uppercase text-[10px] tracking-wider block mb-1.5">
                    Run the setup script on your Pi:
                  </span>
                  <div className="relative group">
                    <pre className="bg-black/90 p-3 rounded-lg border border-zinc-800 text-[11px] font-mono text-emerald-400 select-all overflow-x-auto">
{`bash scripts/install_pi4.sh`}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('bash scripts/install_pi4.sh');
                        setPresetToast('Copied script command to clipboard!');
                        setTimeout(() => setPresetToast(null), 3000);
                      }}
                      className="absolute right-2 top-2 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono flex items-center gap-1 transition cursor-pointer"
                      title="Copy command"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>
                </div>

                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850 space-y-1.5 text-[10.5px]">
                  <span className="font-bold text-zinc-300 block mb-1">
                    What <code className="text-red-400 font-mono">scripts/install_pi4.sh</code> configures automatically:
                  </span>
                  <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                    <li><strong>64-bit ARM Check & Minimal Toolchain:</strong> Installs minimal headless build tools without heavy X11/GUI desktop bloat.</li>
                    <li><strong>Official Rust Toolchain:</strong> Provisions the latest 64-bit Rust via <code className="text-zinc-300 font-mono">rustup</code> targeting Cortex-A72 SIMD acceleration.</li>
                    <li><strong>Kernel UDP Socket & Wi-Fi Tuning:</strong> Expands UDP socket buffers to 25 MB and disables 802.11 power saving to eliminate packet jitter.</li>
                    <li><strong>Release Binary Compilation:</strong> Compiles the native headless binary directly on the Pi.</li>
                    <li><strong>Systemd Service:</strong> Creates and enables <code className="text-zinc-200 font-mono">wled-video-sync.service</code> to automatically run on boot.</li>
                  </ul>
                  <p className="text-[10px] text-zinc-500 pt-1 italic">
                    ℹ️ Note: Every single step, explanation, and network tuning parameter is thoroughly commented inside <strong className="text-zinc-400">scripts/install_pi4.sh</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowRustModal(false)}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAVE SCENE PRESET MODAL */}
      {showSavePresetModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#121214] border border-orange-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-bold text-zinc-100">Save Current Scene Preset</h3>
              </div>
              <button
                onClick={() => setShowSavePresetModal(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">Preset Name</label>
                <input
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="e.g. Living Room 16x16 Matrix"
                  className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  placeholder="e.g. 60 FPS DDP setup with ambilight backlights"
                  className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none"
                />
              </div>

              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-850 text-[10.5px] text-zinc-400 space-y-1 font-mono">
                <div>IP: <span className="text-zinc-200">{wledConfig.ipAddress}</span> ({wledConfig.protocol})</div>
                <div>Size: <span className="text-zinc-200">{wledConfig.isMatrix ? `${wledConfig.width}x${wledConfig.height}` : `${wledConfig.totalLEDs} LEDs`}</span></div>
                <div>Aux Targets: <span className="text-zinc-200">{auxiliaryTargets.length} configured</span></div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSavePresetModal(false)}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 text-zinc-400 hover:text-zinc-200 text-xs border border-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveCurrentAsPreset(newPresetName, newPresetDesc)}
                disabled={!newPresetName.trim()}
                className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold text-xs transition cursor-pointer"
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE PRESETS & SCENES LIBRARY MODAL */}
      {showPresetLibraryModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#121214] border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-bold text-zinc-100">Saved Scene Presets ({presets.length})</h3>
              </div>
              <button
                onClick={() => setShowPresetLibraryModal(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={`p-3.5 rounded-xl border transition flex items-center justify-between gap-3 ${
                    activePresetId === preset.id
                      ? 'bg-orange-500/10 border-orange-500/40 ring-1 ring-orange-500/30'
                      : 'bg-zinc-950 border-zinc-850 hover:border-zinc-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-zinc-200">{preset.name}</span>
                      {activePresetId === preset.id && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-mono font-bold">
                          Active
                        </span>
                      )}
                    </div>
                    {preset.description && (
                      <p className="text-[11px] text-zinc-400">{preset.description}</p>
                    )}
                    <div className="text-[10px] font-mono text-zinc-500 flex gap-2">
                      <span>{preset.wledConfig.protocol}</span>
                      <span>•</span>
                      <span>{preset.wledConfig.ipAddress}</span>
                      <span>•</span>
                      <span>{preset.wledConfig.isMatrix ? `${preset.wledConfig.width}x${preset.wledConfig.height}` : `${preset.wledConfig.totalLEDs} LEDs`}</span>
                      {preset.auxiliaryTargets?.length > 0 && (
                        <>
                          <span>•</span>
                          <span>{preset.auxiliaryTargets.length} Aux</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        loadPreset(preset.id);
                        setShowPresetLibraryModal(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs transition cursor-pointer"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deletePreset(preset.id)}
                      className="p-1.5 rounded-lg bg-zinc-900 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                      title="Delete preset"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-850 pt-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={exportPresetsJson}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Export JSON</span>
                </button>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs transition cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Import JSON</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={importPresetsJson}
                    className="hidden"
                  />
                </label>
              </div>

              <button
                onClick={() => setShowPresetLibraryModal(false)}
                className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DMX UNIVERSE PATCH MATRIX MODAL */}
      {showDmxPatchModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#121214] border border-purple-500/30 rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">Multi-Universe DMX Patch Matrix</h3>
                  <p className="text-[11px] text-zinc-400">Route thousands of LEDs across multiple Art-Net 4, sACN E1.31, and DDP targets</p>
                </div>
              </div>
              <button
                onClick={() => setShowDmxPatchModal(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800"
              >
                ✕ Close
              </button>
            </div>

            {/* Patch Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300 border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                    <th className="p-2">Status</th>
                    <th className="p-2">Patch Name</th>
                    <th className="p-2">Protocol</th>
                    <th className="p-2">Target IP</th>
                    <th className="p-2">Port</th>
                    <th className="p-2">Start Univ</th>
                    <th className="p-2">Univ Count</th>
                    <th className="p-2">LED Span</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 font-mono text-[11px]">
                  {dmxPatches.map((patch) => (
                    <tr key={patch.id} className="hover:bg-zinc-900/40">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={patch.enabled}
                          onChange={(e) => {
                            setDmxPatches(prev => prev.map(p => p.id === patch.id ? { ...p, enabled: e.target.checked } : p));
                          }}
                          className="accent-purple-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-2 font-sans font-semibold text-zinc-200">
                        {patch.name}
                      </td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                          patch.protocol === SyncProtocol.DDP ? 'bg-orange-500/20 text-orange-400' :
                          patch.protocol === SyncProtocol.ARTNET ? 'bg-purple-500/20 text-purple-300' :
                          patch.protocol === SyncProtocol.E131 ? 'bg-blue-500/20 text-blue-300' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {patch.protocol}
                        </span>
                      </td>
                      <td className="p-2 text-zinc-400">{patch.targetIp}</td>
                      <td className="p-2 text-zinc-400">{patch.targetPort}</td>
                      <td className="p-2 text-zinc-300">{patch.startUniverse}</td>
                      <td className="p-2 text-zinc-300">{patch.universeCount}</td>
                      <td className="p-2 text-emerald-400 font-semibold">{patch.ledCount} LEDs</td>
                      <td className="p-2 text-right">
                        <button
                          onClick={() => setDmxPatches(prev => prev.filter(p => p.id !== patch.id))}
                          className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Add Patch Form */}
            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-850 space-y-3">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide block">
                + Add New DMX / Lighting Patch
              </span>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase block mb-1">Protocol</label>
                  <select
                    id="new-patch-proto"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs font-mono"
                    defaultValue={SyncProtocol.ARTNET}
                  >
                    {Object.values(SyncProtocol).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase block mb-1">Target IP</label>
                  <input
                    id="new-patch-ip"
                    type="text"
                    defaultValue="192.168.1.200"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase block mb-1">Start Univ</label>
                  <input
                    id="new-patch-univ"
                    type="number"
                    defaultValue={0}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase block mb-1">LED Count</label>
                  <input
                    id="new-patch-leds"
                    type="number"
                    defaultValue={510}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs font-mono"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      const proto = (document.getElementById('new-patch-proto') as HTMLSelectElement).value as SyncProtocol;
                      const ip = (document.getElementById('new-patch-ip') as HTMLInputElement).value;
                      const univ = Number((document.getElementById('new-patch-univ') as HTMLInputElement).value);
                      const leds = Number((document.getElementById('new-patch-leds') as HTMLInputElement).value);
                      const port = proto === SyncProtocol.DDP ? 4048 : proto === SyncProtocol.ARTNET ? 6454 : proto === SyncProtocol.E131 ? 5568 : 21324;
                      const univCount = Math.ceil(leds / 170);

                      const newPatch: DmxUniversePatch = {
                        id: `patch-${Date.now()}`,
                        name: `${proto} Stage Fixture #${dmxPatches.length + 1}`,
                        targetIp: ip,
                        targetPort: port,
                        protocol: proto,
                        startUniverse: univ,
                        universeCount: univCount,
                        channelsPerUniverse: 510,
                        startLedIndex: 0,
                        ledCount: leds,
                        enabled: true,
                      };

                      setDmxPatches(prev => [...prev, newPatch]);
                    }}
                    className="w-full py-1.5 px-3 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition cursor-pointer"
                  >
                    Add Patch
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowDmxPatchModal(false)}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition cursor-pointer"
              >
                Close & Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
