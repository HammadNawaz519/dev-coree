import React, { useState, useEffect } from 'react';
import { useStore } from './store';
import MapBox from './components/MapBox';
import { AlertPanel, ShipList, ShipDetail, CaptainPanel, ZonePanel, WeatherPanel,
         CaptainVitals, CaptainAlerts, CaptainDirectives, CaptainDistress, CaptainS2S,
         AdvisorPanel } from './components/Panels';
import './index.css';

const SHIPS_META = [
  { id: 'MV-1',  name: 'Aurora'  }, { id: 'MV-2',  name: 'Borealis' }, { id: 'MV-3',  name: 'Cygnus'  },
  { id: 'MV-4',  name: 'Dragon'  }, { id: 'MV-5',  name: 'Emerald'  }, { id: 'MV-6',  name: 'Falcon'  },
  { id: 'MV-7',  name: 'Gharial' }, { id: 'MV-8',  name: 'Halcyon'  }, { id: 'MV-9',  name: 'Iris'    },
  { id: 'MV-10', name: 'Jade'    }, { id: 'MV-11', name: 'Kite'     }, { id: 'MV-12', name: 'Lotus'   },
  { id: 'MV-13', name: 'Mirage'  }, { id: 'MV-14', name: 'Nova'     }, { id: 'MV-15', name: 'Orca'    },
];

// ── Landing Page ──────────────────────────────────────────────────────────────
function Landing({ onEnter }) {
  return (
    <div className="landing">
      <div className="landing__orbs" aria-hidden="true">
        <span className="orb orb--teal" />
        <span className="orb orb--amber" />
        <span className="orb orb--steel" />
      </div>
      <div className="landing__gridlines" aria-hidden="true" />

      <div className="landing__content">
        <div className="landing__badge reveal">
          <span className="badge-dot" />
          Fleetwatch Ops · Live
        </div>

        <section className="landing__hero reveal delay-1">
          <div className="landing__eyebrow">Strait of Hormuz · Real-time Fleet Operations</div>
          <h1 className="landing__title">Maritime Command</h1>
          <p className="landing__subtitle">
            Track 15 vessels, route around risk zones, and respond to distress signals in real-time.
          </p>
          <div className="landing__stats">
            {[
              { value: '15', label: 'Vessels' },
              { value: '1 Hz', label: 'Updates' },
              { value: 'AI', label: 'Distress NLP' },
              { value: 'A*', label: 'Routing' },
            ].map(({ value, label }) => (
              <div key={label} className="stat-card">
                <div className="stat-value">{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>
          <div className="landing__note">Geofencing · Proximity alerts · Weather-aware routing · 1-hr playback</div>
        </section>

        <section className="landing__choices reveal delay-2">

          {/* Fleet Command card */}
          <div className="role-card" style={{ '--accent': '#4F88A8', '--accent-strong': '#3C6F8F', '--accent-soft': '#e8f4fb' }}>
            <div className="role-card__icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4F88A8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <div className="role-card__title">Fleet Command</div>
            <p className="role-card__desc">Oversee the entire fleet, draw restricted zones, and issue directives to any vessel.</p>
            <ul className="role-card__list">
              {['Live map of all 15 ships', 'Draw & delete restricted zones', 'Issue directives to captains', 'AI fleet advisor', '1-hour playback timeline'].map(f => (
                <li key={f} className="role-card__item">
                  <span className="role-card__bullet" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button onClick={() => onEnter('command', null)} className="role-card__button">
              Enter Command
            </button>
          </div>

          {/* Ship Captain card */}
          <div className="role-card" style={{ '--accent': '#2e7d6e', '--accent-strong': '#256358', '--accent-soft': '#e8f6f3' }}>
            <div className="role-card__icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2e7d6e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
              </svg>
            </div>
            <div className="role-card__title">Ship Captain</div>
            <p className="role-card__desc">Your ship view. Receive directives from Command and submit distress signals.</p>

            <div className="vessel-dropdown--open">
              <div className="vessel-dropdown__label">Select a vessel to board</div>
              <div className="vessel-dropdown__grid">
                {SHIPS_META.map(s => (
                  <button key={s.id} onClick={() => onEnter('captain', s.id)} className="vessel-btn">
                    <span className="vessel-btn__name">{s.name}</span>
                    <span className="vessel-btn__id">{s.id}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}

// ── Shared status pill ────────────────────────────────────────────────────────
function ConnPill({ connected }) {
  return (
    <span className={`app-pill ${connected ? 'app-pill--green' : 'app-pill--red'}`}>
      <span className="app-pill__dot" />
      {connected ? 'LIVE' : 'OFFLINE'}
    </span>
  );
}

// ── Command Interface ─────────────────────────────────────────────────────────
function CommandApp() {
  const ships            = useStore(s => s.ships);
  const weatherZones     = useStore(s => s.weatherZones);
  const selectedShipId   = useStore(s => s.selectedShipId);
  const setSelectedShipId = useStore(s => s.setSelectedShipId);
  const alerts           = useStore(s => s.alerts);
  const tick             = useStore(s => s.tick);
  const connected        = useStore(s => s.connected);
  const playbackMode     = useStore(s => s.playbackMode);
  const history          = useStore(s => s.history);
  const playbackIndex    = useStore(s => s.playbackIndex);
  const setPlaybackIndex  = useStore(s => s.setPlaybackIndex);
  const loadHistory      = useStore(s => s.loadHistory);
  const exitPlayback     = useStore(s => s.exitPlayback);
  const zones            = useStore(s => s.zones);
  
  const [rightTab, setRightTab] = useState('ship'); // 'ship' | 'zones' | 'weather' | 'advisor'
  const [advisorData, setAdvisorData] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const runAdvisor = async () => {
    setAdvisorLoading(true);
    try {
      const apiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (apiKey) {
        const systemPrompt = `You are the Fleet Command AI Advisor.
Current fleet state:
- Ships: ${ships.length} (${ships.filter(s => s.status !== 'normal').length} off-nominal)
- Active Alerts: ${alerts.filter(a => !a.acknowledged).length} unacknowledged
- Weather Zones: ${weatherZones.length} active storms
- Restricted Zones: ${zones.length}

Analyze this state and provide exactly 3 strategic, actionable recommendations for the Fleet Commander. Focus on routing efficiency, fuel conservation, and distress response.
Output STRICTLY valid JSON like:
{ "recommendations": [ { "title": "...", "description": "...", "priority": "high|medium|low" } ] }`;

        // Model fallback chain — Groq free tier, tries each until one succeeds
        const MODELS = [
          import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'gemma2-9b-it',
          'mixtral-8x7b-32768',
        ];

        let lastErr = null;
        for (const model of MODELS) {
          try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ model, messages: [{ role: 'user', content: systemPrompt }] }),
            });

            if (res.status === 429) {
              lastErr = `${model} rate limited`;
              await new Promise(r => setTimeout(r, 1200));
              continue;
            }
            if (!res.ok) { lastErr = `${model} returned ${res.status}`; continue; }
            const json = await res.json();
            const text = json.choices?.[0]?.message?.content || '';
            const m = text.match(/\{[\s\S]*\}/);
            if (!m) { lastErr = `${model} gave unparseable response`; continue; }
            setAdvisorData(JSON.parse(m[0]));
            setAdvisorLoading(false);
            return;
          } catch (e) { lastErr = e.message; }
        }
        throw new Error(lastErr || 'All models unavailable');
      } else {
        // No API key — fall back to backend
        const BACKEND = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '');
        const r = await fetch(`${BACKEND}/api/advisor`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        });
        if (!r.ok) throw new Error();
        setAdvisorData(await r.json());
      }
    } catch (e) {
      setAdvisorData({ error: `Advisor unavailable — ${e.message || 'check OPENROUTER_API_KEY'}` });
    }
    setAdvisorLoading(false);
  };

  const unacked = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="app-topbar">
        <div className="app-topbar__left">
          <span className="app-logo">FLEETWATCH <span className="app-logo__sub">COMMAND</span></span>
          <span className="app-tick">TICK #{tick}</span>
        </div>
        <div className="app-topbar__right">
          {unacked > 0 && (
            <span className="app-pill app-pill--red">
              <span className="app-pill__dot" style={{ animationDuration: '0.7s' }} />
              {unacked} ALERT{unacked !== 1 ? 'S' : ''}
            </span>
          )}
          <ConnPill connected={connected} />
          <button className="app-btn app-btn--ghost" onClick={playbackMode ? exitPlayback : loadHistory}>
            {playbackMode ? 'Exit Playback' : 'Playback'}
          </button>
          <button className="app-btn app-btn--ghost" onClick={() => window.location.reload()}>← Exit</button>
        </div>
      </header>

      {/* Main 3-column layout */}
      <div className="app-body app-body--three-col">
        {/* Left: Fleet list + Alerts */}
        <aside className="app-sidebar">
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__title">Fleet Status</div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <ShipList onSelect={setSelectedShipId} />
            </div>
          </div>
          <div className="sidebar-divider" />
          <div className="sidebar-section sidebar-section--alerts">
            <div className="sidebar-section__title">
              Alerts {unacked > 0 && <span className="sidebar-badge">{unacked}</span>}
            </div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <AlertPanel />
            </div>
          </div>
        </aside>

        {/* Center: Map */}
        <main className="app-main">
          <MapBox isCommand={true} />
          {playbackMode && (
            <div className="playback-bar">
              <span className="playback-bar__label">PLAYBACK</span>
              <input
                type="range" min={0} max={Math.max(0, history.length - 1)}
                value={playbackIndex}
                onChange={e => setPlaybackIndex(Number(e.target.value))}
                className="playback-bar__slider"
              />
              <span className="playback-bar__time">
                {history[playbackIndex]
                  ? new Date(history[playbackIndex].timestamp * 1000).toLocaleTimeString()
                  : '--:--:--'}
              </span>
            </div>
          )}
        </main>

        {/* Right: Ship detail + Zones */}
        <aside className="app-sidebar">
          {/* Tab buttons */}
          <div style={{display:'flex',flexWrap:'wrap',borderBottom:'1px solid rgba(129, 166, 198, 0.12)',flexShrink:0}}>
            {[
              { id: 'ship',    label: 'Ship' },
              { id: 'zones',   label: `Zones${zones.length > 0 ? ` (${zones.length})` : ''}` },
              { id: 'weather', label: 'Weather' },
              { id: 'advisor', label: 'AI Advisor' },
            ].map(tab => (
              <button key={tab.id} onClick={() => { setRightTab(tab.id); if (tab.id === 'advisor' && !advisorData) runAdvisor(); }}
                style={{
                  flex:1, minWidth:'20%', padding:'10px 4px', fontSize:'10px', fontWeight:700,
                  letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer',
                  border:'none', background:'transparent',
                  color: rightTab === tab.id ? '#81A6C6' : '#5f6b77',
                  borderBottom: rightTab === tab.id ? '2px solid #81A6C6' : 'none',
                  transition:'all 0.2s',
                }}
              >{tab.label}</button>
            ))}
          </div>
          
          {/* Tab content */}
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__title">
              {rightTab === 'ship' ? 'Ship Detail' : rightTab === 'zones' ? 'Restricted Zones' : rightTab === 'weather' ? 'Weather Systems' : 'AI Fleet Advisor'}
            </div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              {rightTab === 'ship' ? (
                <ShipDetail shipId={selectedShipId} />
              ) : rightTab === 'zones' ? (
                <ZonePanel />
              ) : rightTab === 'weather' ? (
                <WeatherPanel />
              ) : (
                <AdvisorPanel data={advisorData} loading={advisorLoading} onRefresh={runAdvisor} />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Captain Interface ─────────────────────────────────────────────────────────
const CAP_STATUS_COLOR = {
  normal:'#2e7d6e', rerouting:'#c07c2b', distressed:'#c0392b',
  stopped:'#81A6C6', stranded:'#7b3fa0', arrived:'#1a6b95', insufficient_fuel:'#b85c00',
};

function CaptainApp({ shipId }) {
  const connected = useStore(s => s.connected);
  const ships     = useStore(s => s.ships);
  const alerts    = useStore(s => s.alerts);
  const tick      = useStore(s => s.tick);
  const ackAlert  = useStore(s => s.ackAlert);
  const ship      = ships.find(s => s.id === shipId);

  const myAlerts  = alerts.filter(a => a.ship_ids?.includes(shipId));
  const unacked   = myAlerts.filter(a => !a.acknowledged).length;
  const statusColor = CAP_STATUS_COLOR[ship?.status] || '#81A6C6';

  const [rightTab, setRightTab] = useState('directives');

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="app-topbar">
        <div className="app-topbar__left">
          <span className="app-logo" style={{ color: statusColor }}>
            {ship ? ship.name : shipId} <span className="app-logo__sub">CAPTAIN</span>
          </span>
          <span className="app-tick">TICK #{tick}</span>
          {ship && (
            <span style={{
              fontSize:'10px', fontWeight:800, letterSpacing:'0.12em',
              textTransform:'uppercase', padding:'2px 10px', borderRadius:999,
              color: statusColor, background:`${statusColor}18`, border:`1px solid ${statusColor}33`,
            }}>
              {ship.status?.replace(/_/g,' ')}
            </span>
          )}
          {ship?.weather_penalty && (
            <span style={{fontSize:'11px',color:'#1a6b95',fontWeight:700,
              padding:'2px 9px',borderRadius:999,background:'#EEF4F8',border:'1px solid #AACDDC'}}>
              Storm +30%
            </span>
          )}
        </div>
        <div className="app-topbar__right">
          {unacked > 0 && (
            <span className="app-pill app-pill--red">
              <span className="app-pill__dot" style={{animationDuration:'0.7s'}} />
              {unacked} ALERT{unacked !== 1 ? 'S' : ''}
            </span>
          )}
          <ConnPill connected={connected} />
          <button className="app-btn app-btn--ghost" onClick={() => window.location.reload()}>← Exit</button>
        </div>
      </header>

      {/* 3-column layout */}
      <div className="app-body app-body--three-col">

        {/* Left: Ship vitals + my alerts */}
        <aside className="app-sidebar">
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__title">My Vessel</div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <CaptainVitals ship={ship} />
            </div>
          </div>
          <div className="sidebar-divider" />
          <div className="sidebar-section sidebar-section--alerts">
            <div className="sidebar-section__title">
              My Alerts {unacked > 0 && <span className="sidebar-badge">{unacked}</span>}
            </div>
            <div className="sidebar-section__body sidebar-section__body--scroll">
              <CaptainAlerts alerts={myAlerts} ackAlert={ackAlert} />
            </div>
          </div>
        </aside>

        {/* Centre: Map — view-only (no draw controls) */}
        <main className="app-main">
          <MapBox isCommand={false} />
        </main>

        {/* Right: Directives / Distress tabs */}
        <aside className="app-sidebar">
          <div style={{display:'flex',borderBottom:'1px solid rgba(129,166,198,0.12)',flexShrink:0}}>
            {[{id:'directives',label:'Directives'},{id:'distress',label:'Distress'},{id:'s2s',label:'Fleet Ops'}].map(tab => (
              <button key={tab.id} onClick={() => setRightTab(tab.id)} style={{
                flex:1, padding:'12px 6px', fontSize:'10px', fontWeight:800,
                letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer',
                border:'none', background:'transparent',
                color: rightTab===tab.id ? '#81A6C6' : '#5f6b77',
                borderBottom: rightTab===tab.id ? '2px solid #81A6C6' : 'none',
                transition:'all 0.2s', whiteSpace:'nowrap',
              }}>{tab.label}</button>
            ))}
          </div>
          <div className="sidebar-section sidebar-section--flex">
            <div className="sidebar-section__body sidebar-section__body--scroll">
              {rightTab === 'directives' && <CaptainDirectives shipId={shipId} />}
              {rightTab === 'distress' && <CaptainDistress shipId={shipId} />}
              {rightTab === 's2s' && <CaptainS2S shipId={shipId} />}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const initSocket = useStore(s => s.initSocket);
  const setRole    = useStore(s => s.setRole);

  useEffect(() => {
    initSocket();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update tab title based on active view
  useEffect(() => {
    if (!session) {
      document.title = 'Maritime Command — Fleetwatch';
    } else if (session.role === 'command') {
      document.title = 'Fleet Command — Maritime Ops';
    } else {
      const ship = SHIPS_META.find(s => s.id === session.captainShipId);
      document.title = ship ? `Capt. ${ship.name} (${ship.id}) — Maritime Ops` : 'Captain View — Maritime Ops';
    }
  }, [session]);

  if (!session) {
    return (
      <Landing
        onEnter={(role, shipId) => {
          setRole(role, shipId);
          setSession({ role, captainShipId: shipId });
          if (shipId) {
            useStore.getState().setSelectedShipId(shipId);
          }
        }}
      />
    );
  }
  if (session.role === 'command') return <CommandApp />;
  return <CaptainApp shipId={session.captainShipId} />;
}
