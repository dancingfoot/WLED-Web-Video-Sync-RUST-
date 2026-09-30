import { useState, useEffect } from 'react';
import { WLEDConfig, AuxiliaryTarget, TargetType, SyncProtocol } from '../types';
import { Video, Monitor, Tv, Lightbulb, Grid, Terminal, Activity, Zap, Sliders, Cpu, Search, Trash2, Plus, Sparkles, AlertCircle } from 'lucide-react';

interface WLEDEmulatorProps {
  pixels: Uint8Array | number[];
  config: WLEDConfig;
  auxTargets?: AuxiliaryTarget[];
  auxPixels?: { [key: string]: Uint8Array };
}

export default function WLEDEmulator({ pixels, config, auxTargets = [], auxPixels = {} }: WLEDEmulatorProps) {
  const [activeTab, setActiveTab] = useState<'MAIN' | 'AMBIENT' | 'ACCENT' | 'ARTNET'>('MAIN');
  const [dmxViewMode, setDmxViewMode] = useState<'DEC' | 'HEX' | 'PCT'>('DEC');
  const [dmxSearchQuery, setDmxSearchQuery] = useState<string>('');
  const [selectedDmxSource, setSelectedDmxSource] = useState<string>('MAIN');
  const [manualOverrides, setManualOverrides] = useState<{ [channel: number]: number }>({});
  const [showAll512, setShowAll512] = useState<boolean>(false);
  const [artNetSequence, setArtNetSequence] = useState<number>(0);
  const [artNetPktsCount, setArtNetPktsCount] = useState<number>(0);
  const [dmxLogs, setDmxLogs] = useState<string[]>(['[00:00:00] Art-Net Simulator initialized.', '[00:00:00] Port 6454 visual packet sniffer active.']);

  // Simulate Art-Net packet transmissions on a steady timer instead of reacting to high-frequency rendering changes
  useEffect(() => {
    if (activeTab !== 'ARTNET') return;

    // Timer to update packet count & sequence at a simulated 45 Hz rate
    const packetInterval = setInterval(() => {
      setArtNetSequence(prev => (prev + 1) % 256);
      setArtNetPktsCount(prev => prev + 1);
    }, 22); // ~45 Hz

    // Timer to print a simulated received frame in the packet sniffer log console every 2.5 seconds
    const logInterval = setInterval(() => {
      const now = new Date().toLocaleTimeString();
      const randomIp = '127.0.0.1';
      const sourceAlias = selectedDmxSource === 'MAIN' ? 'MAIN-WLED' : selectedDmxSource;
      setDmxLogs(prev => {
        const next = [...prev, `[${now}] ArtDmx frame from ${randomIp} -> universe 0, seq ${Math.floor(Math.random() * 256)}, source: ${sourceAlias}`];
        return next.slice(-25); // Keep last 25 logs
      });
    }, 2500);

    return () => {
      clearInterval(packetInterval);
      clearInterval(logInterval);
    };
  }, [activeTab, selectedDmxSource]);

  // Find enabled ambient/accent targets
  const hasAmbient = auxTargets.some(t => t.type === TargetType.AMBIENT_LIGHTPACK && t.enabled);
  const hasAccent = auxTargets.some(t => t.type === TargetType.INDIVIDUAL_ACCENT && t.enabled);

  const pixelCount = config.isMatrix
    ? config.width * config.height
    : config.totalLEDs;

  // Formulate RGB string arrays for ease of rendering
  const ledColors: string[] = [];
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 3;
    const r = pixels[offset] !== undefined ? pixels[offset] : 0;
    const g = pixels[offset + 1] !== undefined ? pixels[offset + 1] : 0;
    const b = pixels[offset + 2] !== undefined ? pixels[offset + 2] : 0;
    ledColors.push(`rgb(${r}, ${g}, ${b})`);
  }

  // Find the first active Backlight target
  const activeBacklight = auxTargets.find(t => t.type === TargetType.AMBIENT_LIGHTPACK && t.enabled);
  const backlightPixels = activeBacklight ? auxPixels[activeBacklight.id] : null;

  // Parse backlight LEDs
  const backlightColors: string[] = [];
  if (activeBacklight && backlightPixels) {
    const totalLEDs = activeBacklight.topLedCount + activeBacklight.rightLedCount + activeBacklight.bottomLedCount + activeBacklight.leftLedCount;
    for (let i = 0; i < totalLEDs; i++) {
      const offset = i * 3;
      const r = backlightPixels[offset] !== undefined ? backlightPixels[offset] : 0;
      const g = backlightPixels[offset + 1] !== undefined ? backlightPixels[offset + 1] : 0;
      const b = backlightPixels[offset + 2] !== undefined ? backlightPixels[offset + 2] : 0;
      backlightColors.push(`rgb(${r}, ${g}, ${b})`);
    }
  }

  // Find active Accent targets
  const activeAccents = auxTargets.filter(t => t.type === TargetType.INDIVIDUAL_ACCENT && t.enabled);

  return (
    <div className="flex flex-col h-full justify-between">
      {/* Dynamic Selector Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-800 pb-3 mb-4 gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Hardware Stream Simulator</h3>
          <p className="text-xs text-zinc-400">
            Real-time projection model mapping raw UDP commands of multiple targets
          </p>
        </div>
        
        {/* Simulation Targets Tab */}
        <div className="flex gap-1 bg-zinc-900/60 p-0.5 rounded-lg border border-zinc-800 self-start md:self-auto overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('MAIN')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold transition-all shrink-0 ${
              activeTab === 'MAIN'
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Grid className="w-3 h-3" /> Main Panel
          </button>
          
          <button
            onClick={() => setActiveTab('AMBIENT')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold transition-all relative shrink-0 ${
              activeTab === 'AMBIENT'
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tv className="w-3 h-3" /> Ambilight
            {!hasAmbient && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-zinc-600 border border-[#121214]" title="Disabled" />
            )}
            {hasAmbient && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-400 border border-[#121214] animate-ping" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('ACCENT')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold transition-all relative shrink-0 ${
              activeTab === 'ACCENT'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Lightbulb className="w-3 h-3" /> Spot Lamps
            {!hasAccent && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-zinc-600 border border-[#121214]" title="Disabled" />
            )}
            {hasAccent && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-400 border border-[#121214] animate-ping" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('ARTNET')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold transition-all relative shrink-0 ${
              activeTab === 'ARTNET'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Terminal className="w-3 h-3" /> {config.protocol} Sniffer
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-[#121214]" title="Raw Packet Sniffer Active!" />
          </button>
        </div>
      </div>

      {/* CORE CANVAS DRAWINGS ROOM */}
      <div className={`flex-1 min-h-[260px] flex justify-center bg-zinc-950 rounded-lg p-6 border border-zinc-800/60 shadow-inner relative overflow-hidden ${
        activeTab === 'MAIN' ? 'items-start' : 'items-center'
      }`}>
        
        {/* Dynamic Screen Glow depending on active tab */}
        {activeTab === 'MAIN' && (
          <div className="absolute inset-x-0 bottom-0 top-0 pointer-events-none opacity-20 filter blur-3xl mix-blend-screen transition-all duration-300 transform scale-110 animate-pulse"
               style={{
                 background: `radial-gradient(circle, ${ledColors[Math.floor(ledColors.length / 2)] || 'rgba(0,0,0,0)'} 0%, rgba(0,0,0,0) 70%)`
               }}
          />
        )}

        {/* TAB 1: MAIN MATRIX / RIBBON SIMULATION */}
        {activeTab === 'MAIN' && (
          config.isMatrix ? (
            <div
              className="grid gap-[3px] select-none justify-center items-center py-2"
              style={{
                gridTemplateColumns: `repeat(${config.width}, minmax(0, 1fr))`,
                width: '100%',
                maxWidth: `${Math.min(config.width * 28, 420)}px`,
                aspectRatio: `${config.width}/${config.height}`
              }}
            >
              {ledColors.map((color, idx) => {
                const row = Math.floor(idx / config.width);
                let col = idx % config.width;
                
                let physicalIndex = idx;
                if (config.serpentine && row % 2 === 1) {
                  col = config.width - 1 - col;
                  physicalIndex = row * config.width + col;
                }
                const displayColor = ledColors[physicalIndex] || 'rgb(0,0,0)';

                return (
                  <div
                    key={idx}
                    className="rounded-full aspect-square relative group transition-all duration-100 ease-in"
                    style={{
                      backgroundColor: displayColor,
                      boxShadow: displayColor !== 'rgb(0,0,0)' 
                        ? `0 0 10px 1.5px ${displayColor}, inset 0 0 1.5px 0.5px rgba(255, 255, 255, 0.4)`
                        : 'inset 0 0 1px 0.5px rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[9px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono shadow-md">
                      #{physicalIndex} : {displayColor}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="w-full flex flex-col items-center py-4">
              <div className="w-full max-w-[450px] overflow-x-auto py-5 px-3 bg-zinc-900/40 rounded border border-zinc-800/40 flex gap-1 items-center justify-start scrollbar-thin">
                {ledColors.map((color, idx) => (
                  <div
                    key={idx}
                    className="w-3.5 h-3.5 rounded-full shrink-0 relative group transition-all duration-100 ease-in"
                    style={{
                      backgroundColor: color,
                      boxShadow: color !== 'rgb(0,0,0)'
                        ? `0 0 9px 1.5px ${color}, inset 0 0 1px 0.5px rgba(255,255,255,0.4)`
                        : 'inset 0 0 1px 0.5px rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[9px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono shadow-md">
                      LED #{idx} : {color}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-2 text-center">
                Main WLED continuous light bead sequence simulator
              </div>
            </div>
          )
        )}

        {/* TAB 2: AMBILIGHT LCD MONITOR SIMULATION */}
        {activeTab === 'AMBIENT' && (
          <div className="w-full flex flex-col items-center justify-center p-2 relative">
            {!hasAmbient ? (
              <div className="text-center text-zinc-500 text-xs py-10 space-y-2">
                <Tv className="w-8 h-8 text-zinc-700 mx-auto" />
                <p>Ambilight Backlight mapping is currently inactive.</p>
                <p className="text-[10px] text-zinc-600">Activate "LCD Backlight (Lightpack/Ambilight)" under hardware config to unlock!</p>
              </div>
            ) : (
              <div className="relative w-[340px] h-[210px] flex items-center justify-center">
                {/* Simulated Monitor Screen Center */}
                <div className="w-60 h-36 bg-zinc-900 rounded-lg border-2 border-zinc-700 shadow-2xl flex flex-col items-center justify-center p-3 text-center z-10 relative">
                  <Monitor className="w-6 h-6 text-zinc-500 mb-1" />
                  <span className="text-[10px] font-bold text-zinc-300">AMBILIGHT BACKLIGHT FEED</span>
                  <span className="text-[8.5px] text-zinc-500 font-mono mt-0.5">
                    {activeBacklight?.ipAddress} | {activeBacklight?.protocol}
                  </span>
                  <span className="text-[8.5px] text-sky-400 font-bold font-mono mt-1 px-1.5 py-0.5 bg-sky-500/5 rounded border border-sky-500/10">
                    {backlightColors.length} LEDs Active
                  </span>
                </div>

                {/* Draw dynamic halo surrounding monitor screen */}
                <div 
                  className="absolute inset-0 pointer-events-none filter blur-2xl opacity-40 rounded transition-all duration-300"
                  style={{
                    background: backlightColors.length > 0 
                      ? `radial-gradient(ellipse, ${backlightColors[0]} 0%, rgba(0,0,0,0) 80%)`
                      : 'rgba(0,0,0,0)'
                  }}
                />

                {/* 1. Draw Top Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.topLedCount }).map((_, idx) => {
                  const colorIdx = idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const leftPercentage = activeBacklight.topLedCount === 1 
                    ? 50 
                    : 15 + (idx / (activeBacklight.topLedCount - 1)) * 70; // Map between bounds of screen
                  return (
                    <div
                      key={`top-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        top: '16px',
                        left: `${leftPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Top LED #${idx}`}
                    />
                  );
                })}

                {/* 2. Draw Right Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.rightLedCount }).map((_, idx) => {
                  const colorIdx = activeBacklight.topLedCount + idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const topPercentage = activeBacklight.rightLedCount === 1 
                    ? 50 
                    : 22 + (idx / (activeBacklight.rightLedCount - 1)) * 56;
                  return (
                    <div
                      key={`right-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        right: '34px',
                        top: `${topPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Right LED #${idx}`}
                    />
                  );
                })}

                {/* 3. Draw Bottom Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.bottomLedCount }).map((_, idx) => {
                  const colorIdx = activeBacklight.topLedCount + activeBacklight.rightLedCount + idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const leftPercentage = activeBacklight.bottomLedCount === 1 
                    ? 50 
                    : 85 - (idx / (activeBacklight.bottomLedCount - 1)) * 70; // Map backwards for CW circle
                  return (
                    <div
                      key={`bottom-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        bottom: '16px',
                        left: `${leftPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Bottom LED #${idx}`}
                    />
                  );
                })}

                {/* 4. Draw Left Edge LEDs */}
                {activeBacklight && Array.from({ length: activeBacklight.leftLedCount }).map((_, idx) => {
                  const colorIdx = activeBacklight.topLedCount + activeBacklight.rightLedCount + activeBacklight.bottomLedCount + idx;
                  const displayColor = backlightColors[colorIdx] || 'rgb(0,0,0)';
                  const topPercentage = activeBacklight.leftLedCount === 1 
                    ? 50 
                    : 78 - (idx / (activeBacklight.leftLedCount - 1)) * 56;
                  return (
                    <div
                      key={`left-${idx}`}
                      className="absolute w-2.5 h-2.5 rounded-full transition-all duration-700"
                      style={{
                        left: '34px',
                        top: `${topPercentage}%`,
                        backgroundColor: displayColor,
                        boxShadow: `0 0 12px 3px ${displayColor}`
                      }}
                      title={`Backlight Left LED #${idx}`}
                    />
                  );
                })}

              </div>
            )}
          </div>
        )}

        {/* TAB 3: INDIVIDUAL STANDING ACCENT LAMPS ACCENTS */}
        {activeTab === 'ACCENT' && (
          <div className="w-full flex flex-col items-center justify-center p-2">
            {!hasAccent ? (
              <div className="text-center text-zinc-500 text-xs py-10 space-y-2">
                <Lightbulb className="w-8 h-8 text-zinc-700 mx-auto" />
                <p>Individual Accent Spotlight mappings are currently inactive.</p>
                <p className="text-[10px] text-zinc-600">Activate an "Individual Accent Lamp" under hardware config config to unlock!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-[420px] py-4">
                {activeAccents.map((accent) => {
                  const accentColor = auxPixels[accent.id];
                  let displayRGB = 'rgb(24, 24, 27)';
                  if (accentColor && accentColor.length >= 3) {
                    displayRGB = `rgb(${accentColor[0]}, ${accentColor[1]}, ${accentColor[2]})`;
                  }

                  return (
                    <div 
                      key={accent.id}
                      className="flex flex-col items-center p-4 bg-zinc-900/30 rounded-xl border border-zinc-800/80 hover:border-zinc-700 transition relative overflow-hidden"
                    >
                      {/* Dynamic light spot behind bulb logo */}
                      <div 
                        className="absolute w-20 h-20 rounded-full filter blur-xl opacity-30 mt-2 pointer-events-none transition-all duration-300"
                        style={{
                          backgroundColor: displayRGB,
                          boxShadow: `0 0 35px 20px ${displayRGB}`
                        }}
                      />
                      
                      <div 
                        className="w-12 h-12 rounded-full border-2 border-zinc-700 flex items-center justify-center z-10 p-1 mb-3 transition-colors duration-200"
                        style={{
                          borderColor: displayRGB !== 'rgb(24, 24, 27)' ? displayRGB : '#3f3f46',
                          backgroundColor: displayRGB
                        }}
                      >
                        <Lightbulb className={`w-6 h-6 ${displayRGB !== 'rgb(24, 24, 27)' ? 'text-zinc-900' : 'text-zinc-500'}`} />
                      </div>

                      <span className="text-[11px] font-bold text-zinc-200">{accent.name}</span>
                      <span className="text-[9px] text-zinc-500 font-mono mt-0.5">{accent.ipAddress}</span>
                      <span className="text-[9px] text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/10 mt-2">
                        {accent.mappedZone}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ARTNET / DMX PROTOCOL PACKET ANALYZER */}
        {activeTab === 'ARTNET' && (
          <div className="w-full flex flex-col items-stretch text-left p-1 h-full max-h-[520px] overflow-y-auto scrollbar-thin">
            
            {/* Upper Telemetry Deck */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3.5">
              <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800">
                <span className="text-[8px] font-extrabold text-zinc-500 uppercase block">
                  {config.protocol === 'E1.31' ? 'sACN Format/Vector' : config.protocol === 'Art-Net' ? 'Art-Net Opcode' : 'Payload Protocol'}
                </span>
                <span className="text-xs font-mono font-bold text-amber-400 block mt-0.5">
                  {config.protocol === 'E1.31' ? '0x02 (DMP Set)' : config.protocol === 'Art-Net' ? '0x5000 (ArtDmx)' : `${config.protocol} Frame`}
                </span>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800">
                <span className="text-[8px] font-extrabold text-zinc-500 uppercase block">Active Universe</span>
                <span className="text-xs font-mono font-bold text-sky-400 block mt-0.5">
                  {config.protocol === 'E1.31' || config.protocol === 'Art-Net'
                    ? `Universe #${config.universe !== undefined ? config.universe : (config.protocol === 'E1.31' ? 1 : 0)}`
                    : 'N/A (Direct UDP)'}
                </span>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800">
                <span className="text-[8px] font-extrabold text-zinc-500 uppercase block">Transmit Sequence</span>
                <span className="text-xs font-mono font-bold text-emerald-400 block mt-0.5">
                  #{artNetSequence} <span className="text-[9px] text-zinc-600 font-normal">/ 255</span>
                </span>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-2 border border-zinc-800 font-mono">
                <span className="text-[8px] font-extrabold text-zinc-500 uppercase block">Tx Packet Rate</span>
                <span className="text-xs font-bold text-rose-400 flex items-center gap-1 mt-0.5">
                  <Activity className="w-3 h-3 text-rose-400 shrink-0 inline animate-pulse" />
                  ~45 pkts/sec
                </span>
              </div>
            </div>

            {/* Controller / Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-zinc-900/20 p-2.5 rounded-lg border border-zinc-800/80 mb-3.5 text-xs">
              <div className="flex flex-col md:flex-row gap-2.5 md:items-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">Source:</span>
                  <select
                    value={selectedDmxSource}
                    onChange={(e) => {
                      setSelectedDmxSource(e.target.value);
                      setManualOverrides({});
                    }}
                    className="bg-zinc-900 text-zinc-200 px-2 py-1 rounded border border-zinc-850 text-[11px] font-mono focus:outline-none"
                  >
                    <option value="MAIN">Main WLED Matrix ({pixelCount * 3} Channels)</option>
                    {hasAmbient && (
                      <option value="AMBIENT">Ambilight LCD Backlight ({backlightColors.length * 3} Channels)</option>
                    )}
                    {activeAccents.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name} Spotlight (3 Channels)</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800 self-start">
                  {(['DEC', 'HEX', 'PCT'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDmxViewMode(mode)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold transition ${
                        dmxViewMode === mode ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5 justify-between">
                <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAll512}
                    onChange={(e) => setShowAll512(e.target.checked)}
                    className="rounded accent-amber-500 bg-zinc-900 border-zinc-800"
                  />
                  Show Full 512
                </label>

                {Object.keys(manualOverrides).length > 0 && (
                  <button
                    onClick={() => setManualOverrides({})}
                    className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[9px] font-bold rounded"
                  >
                    Reset Overrides
                  </button>
                )}
              </div>
            </div>

            {/* Search filter input */}
            <div className="relative mb-3.5">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                value={dmxSearchQuery}
                onChange={(e) => setDmxSearchQuery(e.target.value)}
                placeholder="Search channel number (e.g. 15), pixel index, or component..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
              />
            </div>

            {/* Build DMX stream byte source based on selections */}
            {(() => {
              // Extract current active stream bytes
              let sourceBytes: number[] = [];
              if (selectedDmxSource === 'MAIN') {
                for (let i = 0; i < pixelCount * 3; i++) {
                  sourceBytes.push(pixels[i] !== undefined ? pixels[i] : 0);
                }
              } else if (selectedDmxSource === 'AMBIENT') {
                if (activeBacklight && backlightPixels) {
                  const totalLEDs = activeBacklight.topLedCount + activeBacklight.rightLedCount + activeBacklight.bottomLedCount + activeBacklight.leftLedCount;
                  for (let i = 0; i < totalLEDs * 3; i++) {
                    sourceBytes.push(backlightPixels[i] || 0);
                  }
                }
              } else {
                const accentBytes = auxPixels[selectedDmxSource];
                if (accentBytes && accentBytes.length >= 3) {
                  sourceBytes = [accentBytes[0], accentBytes[1], accentBytes[2]];
                } else {
                  sourceBytes = [0, 0, 0];
                }
              }

              // Apply manual overrides
              const finalBytes = sourceBytes.map((byte, idx) => {
                const channelNum = idx + 1;
                return manualOverrides[channelNum] !== undefined ? manualOverrides[channelNum] : byte;
              });

              // Total channels to render
              const totalChannelsToDisplay = showAll512 ? 512 : Math.max(24, Math.ceil(finalBytes.length / 12) * 12);

              // Render DMX Slots
              const slots = [];
              for (let i = 0; i < totalChannelsToDisplay; i++) {
                const channelNum = i + 1;
                const value = finalBytes[i] !== undefined ? finalBytes[i] : (manualOverrides[channelNum] !== undefined ? manualOverrides[channelNum] : 0);
                const ledIdx = Math.floor(i / 3);
                const componentIdx = i % 3; // 0=R, 1=G, 2=B
                const compLetter = componentIdx === 0 ? 'R' : componentIdx === 1 ? 'G' : 'B';
                const compColor = componentIdx === 0 ? 'border-red-500/30 text-red-500' : componentIdx === 1 ? 'border-emerald-500/30 text-emerald-500' : 'border-sky-500/30 text-sky-500';

                // Skip if doesn't match query
                if (dmxSearchQuery) {
                  const q = dmxSearchQuery.toLowerCase();
                  const matchesChannel = channelNum.toString().includes(q);
                  const matchesPixel = `p${ledIdx + 1}`.includes(q) || `led${ledIdx}`.includes(q);
                  const matchesComp = compLetter.toLowerCase().includes(q) || (componentIdx === 0 ? 'red' : componentIdx === 1 ? 'green' : 'blue').includes(q);
                  if (!matchesChannel && !matchesPixel && !matchesComp) continue;
                }

                slots.push(
                  <div
                    key={channelNum}
                    className={`relative p-2 rounded bg-zinc-950 border transition-all select-none hover:border-zinc-700 hover:bg-zinc-900 group/dmx flex flex-col justify-between ${
                      manualOverrides[channelNum] !== undefined
                        ? 'border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.15)] bg-amber-500/[0.03]'
                        : value > 0 ? 'border-zinc-800' : 'border-zinc-900/60 opacity-60'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-[8px] font-mono text-zinc-500 font-bold">CH{channelNum}</span>
                      {finalBytes[i] !== undefined && (
                        <span className={`text-[7px] font-extrabold px-1 rounded bg-zinc-900 ${compColor}`}>
                          P{ledIdx}-{compLetter}
                        </span>
                      )}
                    </div>

                    <div className="my-1.5 text-center font-mono">
                      <span className={`text-sm font-bold block ${value > 0 ? 'text-zinc-100' : 'text-zinc-700'}`}>
                        {dmxViewMode === 'DEC' && value}
                        {dmxViewMode === 'HEX' && value.toString(16).toUpperCase().padStart(2, '0')}
                        {dmxViewMode === 'PCT' && `${Math.round((value / 255) * 100)}%`}
                      </span>
                    </div>

                    {/* Color bottom border */}
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b overflow-hidden flex">
                      <div
                        className={`h-full ${
                          componentIdx === 0 ? 'bg-red-500' : componentIdx === 1 ? 'bg-emerald-500' : 'bg-sky-500'
                        }`}
                        style={{ width: `${(value / 255) * 100}%` }}
                      />
                    </div>

                    {/* Quick interactive override slider on hover */}
                    <div className="absolute inset-0 bg-zinc-950/95 rounded p-1 opacity-0 group-hover/dmx:opacity-100 transition-opacity flex flex-col justify-center items-center z-10 pointer-events-none group-hover/dmx:pointer-events-auto">
                      <span className="text-[7.5px] font-bold text-amber-500 mb-1">SET VALUE</span>
                      <input
                        type="range"
                        min="0"
                        max="255"
                        value={value}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setManualOverrides(prev => ({ ...prev, [channelNum]: val }));
                        }}
                        className="w-full h-1 bg-zinc-850 rounded bg-zinc-800 cursor-ew-resize accent-amber-500"
                      />
                      <div className="flex justify-between w-full text-[7.5px] font-mono text-zinc-500 mt-1 px-1">
                        <span>0</span>
                        <span className="font-bold text-zinc-300">{value}</span>
                        <span>255</span>
                      </div>
                    </div>
                  </div>
                );
              }

              // Precompile live packet header for documentation display
              const sampleHeaderHex = [
                '41', '72', '74', '2d', '4e', '65', '74', '00', // "Art-Net\0"
                '00', '50',                                     // Opcode ArtDmx (0x5000)
                '00', '0e',                                     // Protocol version 14
                artNetSequence.toString(16).toUpperCase().padStart(2, '0'), // Sequence
                '00',                                           // Physical
                '00', '00',                                     // Universe 0
                Math.min(finalBytes.length, 512).toString(16).toUpperCase().padStart(2, '00').substring(0,2),
                Math.min(finalBytes.length, 512).toString(16).toUpperCase().padStart(2, '00').substring(2,4) || '90' // channel size
              ];

              return (
                <div className="space-y-4">
                  {/* DMX Slots Grid */}
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-1.5 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin">
                    {slots}
                    {slots.length === 0 && (
                      <div className="col-span-full py-10 text-center text-zinc-600 font-mono text-xs">
                        No channels matching "{dmxSearchQuery}" found.
                      </div>
                    )}
                  </div>

                  {/* Packet Formatter Raw Decoder Panel */}
                  <div className="bg-black/90 rounded-lg border border-zinc-900 p-2.5 font-mono text-[9px] text-[#34d399] select-text">
                    <div className="text-[8px] text-zinc-500 uppercase font-black border-b border-zinc-900 pb-1.5 mb-2 flex justify-between items-center">
                      <span className="flex items-center gap-1.5 font-bold">
                        <Sparkles className="w-3 h-3 text-amber-500 shrink-0 inline animate-pulse" />
                        Art-Net Realtime Packet Byte Sniffer (ArtDmx Payload Specification)
                      </span>
                      <span>RFC-1123 DMX UDP GATE</span>
                    </div>

                    <div className="space-y-1 text-zinc-400">
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x00-0x07 (Header ID)   : </span> 
                        <span className="text-zinc-200">41 72 74 2d 4e 65 74 00</span> 
                        <span className="text-zinc-500 ml-2"> &mdash; "Art-Net\0"</span>
                      </div>
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x08-0x09 (Opcode)      : </span> 
                        <span className="text-amber-500 font-bold">00 50</span> 
                        <span className="text-zinc-500 ml-2"> &mdash; Opcode ArtDmx (0x5000)</span>
                      </div>
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x0A-0x0B (Protocol)    : </span> 
                        <span className="text-zinc-200">00 0E</span> 
                        <span className="text-zinc-500 ml-2"> &mdash; Version 14</span>
                      </div>
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x0C      (Sequence)    : </span> 
                        <span className="text-emerald-400 font-bold">{sampleHeaderHex[12]}</span> 
                        <span className="text-zinc-500 ml-2"> &mdash; Live packet sequence counter</span>
                      </div>
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x0D      (Physical)    : </span> 
                        <span className="text-zinc-200">00</span> 
                        <span className="text-zinc-500 ml-2"> &mdash; Physical port #0</span>
                      </div>
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x0E-0x0F (SubUni/Uni)  : </span> 
                        <span className="text-sky-400 font-bold">00 00</span> 
                        <span className="text-zinc-500 ml-2"> &mdash; Sub-Universe 0, Universe 0</span>
                      </div>
                      <div>
                        <span className="text-zinc-650 font-bold text-zinc-600">0x10-0x11 (Channel Count): </span> 
                        <span className="text-rose-400 font-bold">
                          {finalBytes.length.toString(16).toUpperCase().padStart(4, '0').match(/.{1,2}/g)?.join(' ')}
                        </span> 
                        <span className="text-zinc-500 ml-2"> &mdash; DMX Channel size: {finalBytes.length} channels</span>
                      </div>
                      <div className="pt-2 border-t border-zinc-900/60 mt-2 flex justify-between items-center text-[8px] text-zinc-500 font-mono">
                        <span>PORT 6454 OUTFLOW TRANSMISSION ACTIVE &bull; {artNetPktsCount} EN VELOCITY</span>
                        <span className="text-amber-400/80 font-bold">WLED DMX ART-NET BRIDGE IS OPERATIONAL</span>
                      </div>
                    </div>
                  </div>

                  {/* Packet Logger Console */}
                  <div className="bg-zinc-950/70 rounded-lg p-2 border border-zinc-900 font-mono text-[8.5px] text-zinc-500 max-h-[80px] overflow-y-auto scrollbar-thin space-y-0.5">
                    {dmxLogs.map((log, i) => (
                      <div key={i} className="leading-tight">{log}</div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

      </div>
    </div>
  );
}
