/**
 * WLED & DMX Video Sync Types (Rust Engine & Web UI)
 */

export enum SyncProtocol {
  DDP = 'DDP',
  DRGB = 'DRGB',
  WARLS = 'WARLS',
  ARTNET = 'Art-Net',
  E131 = 'E1.31'
}

export enum SourceType {
  WAYLAND_CAPTURE = 'Linux Wayland Screen Capture',
  OMT_STREAM = 'Open Media Transport (OMT)',
  SCREEN_CAPTURE = 'Browser Screen/Window Capture',
  VIDEO_FILE = 'Video File',
  WEBCAM = 'Cam/Webcam Capture',
  YOUTUBE = 'YouTube Stream',
  E_EFFECTS = 'Procedural Effects',
  NDI_IP_STREAM = 'NDI / IP Video Stream'
}

export enum EffectType {
  RAINBOW = 'Rainbow Wave',
  PERLIN_NOISE = 'Perlin Noise Clouds',
  FIRE = 'Raging Fire',
  SINE_WAVES = 'Interfering Sine Waves',
  AUDIO_SPECTRUM = 'Audio Spectrum (Visualizer)',
  SOLID_COLOR = 'Solid Color Gradient'
}

export enum TargetType {
  MAIN = 'Main Device (Matrix/Strip)',
  AMBIENT_LIGHTPACK = 'LCD Backlight (Lightpack/Ambilight)',
  INDIVIDUAL_ACCENT = 'Individual Accent Lamp'
}

export enum AccentMappingZone {
  WHOLE_AVERAGE = 'Whole Screen Average',
  CENTER = 'Center Zone (Inner)',
  TOP = 'Top Edge Average',
  BOTTOM = 'Bottom Edge Average',
  LEFT = 'Left Edge Average',
  RIGHT = 'Right Edge Average'
}

export interface AuxiliaryTarget {
  id: string;
  name: string;
  type: TargetType;
  enabled: boolean;
  ipAddress: string;
  port: number;
  protocol: SyncProtocol;
  universe?: number;
  
  // Ambilight LCD parameters
  topLedCount: number;
  rightLedCount: number;
  bottomLedCount: number;
  leftLedCount: number;
  
  // Accent mapping parameter
  mappedZone: AccentMappingZone;
  accentLedCount: number;

  // Custom Spot Lamp selection mapping
  customMappingEnabled?: boolean;
  customMappingType?: 'single' | 'average';
  customX?: number; // 0 to 100 percentage
  customY?: number; // 0 to 100 percentage
  customWidth?: number; // 1 to 100 percentage
  customHeight?: number; // 1 to 100 percentage
}

export interface DmxUniversePatch {
  id: string;
  name: string;
  targetIp: string;
  targetPort: number;
  protocol: SyncProtocol;
  startUniverse: number;
  universeCount: number;
  channelsPerUniverse: number; // 510 or 512
  startLedIndex: number;
  ledCount: number;
  enabled: boolean;
}

export interface WLEDConfig {
  ipAddress: string;
  port: number;
  protocol: SyncProtocol;
  isMatrix: boolean;
  width: number; // For matrix
  height: number; // For matrix
  totalLEDs: number; // For single strip
  serpentine: boolean;
  reverseRows: boolean;
  vertical: boolean;
  brightness: number; // 0-100%
  contrast: number; // -100 to 100
  saturation: number; // -100 to 100
  gamma: number; // 0.5 to 3.0
  blur: number; // Blur radius
  fpsLimit: number;
  timeout: number; // 2 seconds
  universe?: number;
  
  // Custom mapping coordinates
  customMappingEnabled?: boolean;
  customX?: number;
  customY?: number;
  customWidth?: number;
  customHeight?: number;
}

export interface FrameStats {
  fps: number;
  droppedFrames: number;
  bytesSent: number;
  packetsSent: number;
  latencyMs: number;
  renderTimeUs?: number; // Rust engine sub-millisecond calculation time
}

export interface OmtStreamInput {
  id: string;
  name: string;
  sourceName: string;
  ipAddress: string;
  port: number;
  url: string;
  enabled: boolean;
  resolution: string;
  fps: number;
  status: 'ONLINE' | 'OFFLINE' | 'DISCOVERING';
  codec?: string; // 'VMX' | 'RAW_RGB' | 'RAW_YUV'
  lossRate?: number;
}

export interface NdiStreamInput {
  id: string;
  name: string;
  sourceName: string;
  ipAddress: string;
  port: number;
  url: string;
  enabled: boolean;
  resolution: string;
  fps: number;
  status: 'ONLINE' | 'OFFLINE' | 'DISCOVERING';
}

export interface RustEngineStatus {
  connected: boolean;
  url: string;
  version?: string;
  waylandActive: boolean;
  omtActive: boolean;
  latencyUs: number;
}

export interface WLEDScenePreset {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  wledConfig: WLEDConfig;
  auxiliaryTargets: AuxiliaryTarget[];
  activeSource: SourceType;
  activeEffect: EffectType;
  dmxPatches?: DmxUniversePatch[];
  cropRect?: { x: number; y: number; width: number; height: number };
}

