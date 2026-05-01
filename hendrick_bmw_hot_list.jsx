import { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import {
  Phone, MessageSquare, Mail, Plus, Search, X, Check, ChevronRight,
  Trash2, Car, ArrowLeft, Edit3, FileText, Upload, Download,
  MoreVertical, FileUp, Flame, Key, Handshake, Zap,
  AlertCircle, Activity, Sparkles
} from 'lucide-react';

// ---- Helpers ----
const todayISO = () => new Date().toISOString().split('T')[0];

const daysSince = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  const d = daysSince(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d/7)}w ago`;
  if (d < 365) return `${Math.floor(d/30)}mo ago`;
  return `${Math.floor(d/365)}y ago`;
};

const fmtPhone = (s) => {
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  return s;
};

const cleanPhone = (p) => {
  if (!p) return '';
  const digits = p.toString().replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
};

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

// ============================================================================
// THE HOT LIST SCORING ENGINE
// ============================================================================
// Each lead gets a 0-100 score recomputed live from logged signals.
// No manual status setting — score IS the status.

const ACTIVITY_TYPES = {
  'Test drive': { icon: Key,           color: '#dc2626', weight: 35, points: true },
  'Visit':      { icon: Handshake,     color: '#7c3aed', weight: 8,  points: true },
  'Call':       { icon: Phone,         color: '#0284c7', weight: 5,  points: true },
  'Text':       { icon: MessageSquare, color: '#0284c7', weight: 4,  points: true },
  'Email':      { icon: Mail,          color: '#0284c7', weight: 3,  points: true },
  'They reached out': { icon: Zap,     color: '#ea580c', weight: 12, points: true },
  'Note':       { icon: FileText,      color: '#6b7280', weight: 0,  points: false },
};

function computeScore(lead) {
  if (!lead) return { score: 0, breakdown: [] };
  const breakdown = [];
  let score = 0;
  const notes = lead.notes || [];

  // 1. Test drive — biggest signal
  const testDrives = notes.filter(n => n.type === 'Test drive');
  if (testDrives.length > 0) {
    const mostRecent = testDrives[0];
    const d = daysSince(mostRecent.date);
    let pts = 0;
    if (d <= 1) pts = 35;
    else if (d <= 3) pts = 30;
    else if (d <= 7) pts = 25;
    else if (d <= 14) pts = 18;
    else if (d <= 30) pts = 10;
    else if (d <= 60) pts = 5;
    if (pts > 0) {
      score += pts;
      breakdown.push({ label: `Test drove ${fmtRelative(mostRecent.date)}`, pts, big: true });
    }
    if (testDrives.length >= 2) {
      score += 10;
      breakdown.push({ label: `${testDrives.length} test drives logged`, pts: 10 });
    }
  }

  // 2. Touch count — engagement compounds
  const realTouches = notes.filter(n => ACTIVITY_TYPES[n.type]?.points);
  const touchCount = realTouches.length;
  if (touchCount >= 6) {
    score += 20;
    breakdown.push({ label: `${touchCount} total touches`, pts: 20 });
  } else if (touchCount >= 4) {
    score += 14;
    breakdown.push({ label: `${touchCount} total touches`, pts: 14 });
  } else if (touchCount >= 3) {
    score += 8;
    breakdown.push({ label: `${touchCount} total touches`, pts: 8 });
  } else if (touchCount >= 2) {
    score += 4;
    breakdown.push({ label: `${touchCount} touches logged`, pts: 4 });
  }

  // 3. Inbound — they reached out
  const inboundCount = notes.filter(n => n.type === 'They reached out').length;
  if (inboundCount > 0) {
    const pts = Math.min(inboundCount * 12, 24);
    score += pts;
    breakdown.push({ label: `${inboundCount}× they reached out to you`, pts, big: inboundCount >= 2 });
  }

  // 4. Recency
  const lastTouch = realTouches[0];
  if (lastTouch) {
    const d = daysSince(lastTouch.date);
    let pts = 0;
    if (d <= 1) pts = 12;
    else if (d <= 3) pts = 8;
    else if (d <= 7) pts = 4;
    else if (d <= 14) pts = 1;
    else if (d > 30) pts = -8;
    else if (d > 21) pts = -4;
    if (pts !== 0) {
      score += pts;
      breakdown.push({
        label: pts > 0 ? `Recent contact (${fmtRelative(lastTouch.date)})` : `Going stale (${fmtRelative(lastTouch.date)})`,
        pts,
      });
    }
  } else {
    const ageInDays = daysSince(lead.created);
    if (ageInDays > 3) {
      score -= 5;
      breakdown.push({ label: 'No contact logged yet', pts: -5 });
    }
  }

  // 5. Vehicle interest specified
  if (lead.vehicle && lead.vehicle.trim()) {
    score += 3;
    breakdown.push({ label: 'Vehicle interest specified', pts: 3 });
  }

  score = Math.max(0, Math.min(100, score));
  return { score, breakdown };
}

function tempLabel(score) {
  if (score >= 70) return { label: 'BLAZING', color: '#dc2626', bg: '#fee2e2' };
  if (score >= 50) return { label: 'HOT',     color: '#ea580c', bg: '#ffedd5' };
  if (score >= 30) return { label: 'WARM',    color: '#d97706', bg: '#fef3c7' };
  if (score >= 15) return { label: 'COOL',    color: '#0891b2', bg: '#cffafe' };
  return                  { label: 'COLD',    color: '#64748b', bg: '#f1f5f9' };
}

const HOT_THRESHOLD = 50;

// ============================================================================
// CSV import helpers
// ============================================================================
const FIELD_PATTERNS = {
  firstName: /^(first.?name|fname|given.?name)$/i,
  lastName:  /^(last.?name|lname|surname|family.?name)$/i,
  fullName:  /^(name|customer.?name|full.?name|contact.?name)$/i,
  phone:     /(cell|mobile|phone|tel)/i,
  email:     /(email|e.?mail)/i,
  vehicle:   /(vehicle|model|interest|voi|stock)/i,
  notes:     /(notes?|comments?|description|remarks)/i,
};

const detectFieldForColumn = (col) => {
  for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
    if (pattern.test(col.trim())) return field;
  }
  return 'ignore';
};

const rowToLead = (row, mapping) => {
  const get = (field) => {
    const col = Object.entries(mapping).find(([, f]) => f === field)?.[0];
    return col ? (row[col] || '').toString().trim() : '';
  };
  const fullName = get('fullName');
  const fname = get('firstName');
  const lname = get('lastName');
  const name = fullName || [fname, lname].filter(Boolean).join(' ');
  if (!name) return null;
  return {
    id: newId(),
    name,
    phone: cleanPhone(get('phone')),
    email: get('email'),
    vehicle: get('vehicle'),
    notes: get('notes') ? [{
      id: newId(), type: 'Note', text: `From CRM: ${get('notes')}`,
      date: todayISO(), ts: Date.now(),
    }] : [],
    created: todayISO(),
  };
};

const exportLeadsToCSV = (leads) => {
  const data = leads.map(l => {
    const { score } = computeScore(l);
    return {
      Name: l.name,
      Phone: l.phone ? fmtPhone(l.phone) : '',
      Email: l.email || '',
      Vehicle: l.vehicle || '',
      'Hot Score': score,
      Touches: (l.notes || []).filter(n => ACTIVITY_TYPES[n.type]?.points).length,
      'Test Drives': (l.notes || []).filter(n => n.type === 'Test drive').length,
      'Last Contact': l.notes && l.notes[0] ? l.notes[0].date : '',
      Created: l.created || '',
    };
  });
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hendrick-bmw-hotlist-${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ============================================================================
// MAIN
// ============================================================================
export default function HotList() {
  const [leads, setLeads] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('list');
  const [activeId, setActiveId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get('hotlist_v1');
        if (r && r.value) setLeads(JSON.parse(r.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  const persist = async (next) => {
    setLeads(next);
    try { await window.storage.set('hotlist_v1', JSON.stringify(next)); }
    catch (e) { console.error(e); }
  };

  const upsert = (lead) => {
    const cleanLead = { ...lead };
    delete cleanLead._score;
    const exists = leads.find(l => l.id === cleanLead.id);
    persist(exists ? leads.map(l => l.id === cleanLead.id ? cleanLead : l) : [cleanLead, ...leads]);
  };

  const bulkAdd = (newLeads) => {
    const existingKeys = new Set(leads.map(l => `${l.name.toLowerCase()}|${l.phone}`));
    const filtered = newLeads.filter(nl => !existingKeys.has(`${nl.name.toLowerCase()}|${nl.phone}`));
    persist([...filtered, ...leads]);
    return { added: filtered.length, skipped: newLeads.length - filtered.length };
  };

  const remove = (id) => persist(leads.filter(l => l.id !== id));

  const scoredLeads = useMemo(() => {
    return leads
      .map(l => ({ ...l, _score: computeScore(l) }))
      .sort((a, b) => b._score.score - a._score.score);
  }, [leads]);

  const hotLeads = useMemo(() => scoredLeads.filter(l => l._score.score >= HOT_THRESHOLD), [scoredLeads]);

  const visibleLeads = useMemo(() => {
    let list = showAll ? scoredLeads : hotLeads;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) ||
        (l.vehicle || '').toLowerCase().includes(q) ||
        (l.phone || '').includes(q) ||
        (l.notes || []).some(n => (n.text || '').toLowerCase().includes(q))
      );
    }
    return list;
  }, [scoredLeads, hotLeads, showAll, search]);

  const activeLead = leads.find(l => l.id === activeId);
  const activeScored = activeLead ? { ...activeLead, _score: computeScore(activeLead) } : null;

  return (
    <div style={{ fontFamily: 'Montserrat, system-ui, sans-serif', minHeight: '100vh', background: '#f6f7f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');
        @keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes flame { 0%,100% { transform:scale(1) rotate(-2deg); } 50% { transform:scale(1.08) rotate(2deg); } }
        .lead-card { animation: slideUp 0.25s ease-out both; }
        .blazing-flame { animation: flame 1.5s ease-in-out infinite; display: inline-block; }
        input:focus, textarea:focus, select:focus { outline: none; border-color: #00558C !important; box-shadow: 0 0 0 3px rgba(0,85,140,0.12); }
        .btn-primary { background: #00558C; color: white; transition: all 0.15s; }
        .btn-primary:hover { background: #003d66; transform: translateY(-1px); }
      `}</style>

      {view === 'list' && (
        <ListView
          leads={visibleLeads} totalCount={leads.length} hotCount={hotLeads.length}
          showAll={showAll} setShowAll={setShowAll}
          search={search} setSearch={setSearch}
          onOpen={(id) => { setActiveId(id); setView('detail'); }}
          onAdd={() => setView('add')}
          onImport={() => setView('import')}
          onExport={() => exportLeadsToCSV(leads)}
          loaded={loaded}
        />
      )}
      {view === 'detail' && activeScored && (
        <DetailView lead={activeScored} onBack={() => { setActiveId(null); setView('list'); }} onSave={upsert} onDelete={(id) => { remove(id); setActiveId(null); setView('list'); }} />
      )}
      {view === 'add' && (
        <AddEditView onBack={() => setView('list')} onSave={(lead) => { upsert(lead); setActiveId(lead.id); setView('detail'); }} />
      )}
      {view === 'import' && (
        <ImportView onBack={() => setView('list')} onImport={bulkAdd} onDone={() => setView('list')} />
      )}
    </div>
  );
}

// ============================================================================
// LIST VIEW
// ============================================================================
function ListView({ leads, totalCount, hotCount, showAll, setShowAll, search, setSearch, onOpen, onAdd, onImport, onExport, loaded }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div>
      <div style={{ background: 'linear-gradient(135deg, #00558C 0%, #003d66 100%)', color: 'white', padding: '20px 18px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', opacity: 0.85, fontStyle: 'italic' }}>HENDRICK BMW</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '2px 0 0', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="blazing-flame">🔥</span> Hot List
            </h1>
          </div>
          <button onClick={() => setShowMenu(true)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MoreVertical size={18} />
          </button>
        </div>

        {totalCount > 0 && (
          <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{hotCount}</div>
              <div style={{ opacity: 0.8, fontSize: 11, marginTop: 2 }}>HOT NOW</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.2)' }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{totalCount}</div>
              <div style={{ opacity: 0.8, fontSize: 11, marginTop: 2 }}>TOTAL LEADS</div>
            </div>
          </div>
        )}

        {totalCount > 0 && (
          <div style={{ position: 'relative', marginTop: 14 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, vehicle, notes…"
              style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        )}
      </div>

      {totalCount > 0 && (
        <div style={{ background: 'white', padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAll(false)} style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer', background: !showAll ? '#00558C' : '#f3f4f6', color: !showAll ? 'white' : '#374151', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Flame size={14} /> Hot only ({hotCount})
          </button>
          <button onClick={() => setShowAll(true)} style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer', background: showAll ? '#00558C' : '#f3f4f6', color: showAll ? 'white' : '#374151', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>
            All leads ({totalCount})
          </button>
        </div>
      )}

      <div style={{ padding: 12, paddingBottom: 100 }}>
        {!loaded ? null : totalCount === 0 ? (
          <FirstRunEmpty onImport={onImport} onAdd={onAdd} />
        ) : leads.length === 0 ? (
          showAll ? (
            <Empty title="No matches" sub="Try a different search." />
          ) : (
            <Empty
              icon={<Sparkles size={32} color="#00558C" />}
              title="No hot leads yet"
              sub="Log a test drive or 3+ touches on a lead to push them onto the hot list."
              action={{ label: 'See all leads', onClick: () => setShowAll(true) }}
            />
          )
        ) : (
          leads.map((lead, i) => (<LeadCard key={lead.id} lead={lead} onOpen={() => onOpen(lead.id)} index={i} />))
        )}
      </div>

      <button onClick={onAdd} className="btn-primary" style={{ position: 'fixed', bottom: 20, right: 20, width: 56, height: 56, borderRadius: '50%', border: 'none', boxShadow: '0 8px 24px rgba(0,85,140,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Plus size={26} strokeWidth={2.5} />
      </button>

      {showMenu && (
        <MenuSheet onClose={() => setShowMenu(false)} onImport={() => { setShowMenu(false); onImport(); }} onExport={() => { setShowMenu(false); onExport(); }} totalCount={totalCount} />
      )}
    </div>
  );
}

function FirstRunEmpty({ onImport, onAdd }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 36 }}>🔥</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 8px' }}>Build your hot list</h2>
      <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 24px', lineHeight: 1.5, maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
        Add prospects, log activity. Test drives and multiple touches push leads to the top automatically. Let eLead handle scheduling and follow-up.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={onImport} className="btn-primary" style={{ padding: '11px 18px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Upload size={15} /> Import from eLead
        </button>
        <button onClick={onAdd} style={{ padding: '11px 18px', borderRadius: 10, border: '1.5px solid #00558C', background: 'white', color: '#00558C', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Plus size={15} /> Add manually
        </button>
      </div>
      <div style={{ marginTop: 32, padding: 16, background: 'white', borderRadius: 12, textAlign: 'left' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#00558C', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontStyle: 'italic' }}>How scoring works</div>
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
          <div>🔑 <strong>Test drove recently</strong> — biggest single signal (up to 35 pts)</div>
          <div>⚡ <strong>They reached out to you</strong> — inbound = serious (12 pts each)</div>
          <div>🤝 <strong>Multiple touches</strong> — engagement compounds (up to 20 pts)</div>
          <div>🔥 <strong>Recent contact</strong> — fresh = hotter (up to 12 pts)</div>
        </div>
      </div>
    </div>
  );
}

function Empty({ icon, title, sub, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6b7280' }}>
      {icon && <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center' }}>{icon}</div>}
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{title}</div>
      {sub && <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5, maxWidth: 300, margin: '4px auto 0' }}>{sub}</div>}
      {action && (
        <button onClick={action.onClick} style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#00558C', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          {action.label} →
        </button>
      )}
    </div>
  );
}

// ============================================================================
// LEAD CARD
// ============================================================================
function LeadCard({ lead, onOpen, index }) {
  const { score, breakdown } = lead._score;
  const temp = tempLabel(score);
  const lastNote = (lead.notes || []).find(n => ACTIVITY_TYPES[n.type]?.points);
  const topSignals = breakdown.filter(b => b.big || b.pts >= 10).slice(0, 2);

  return (
    <div className="lead-card" onClick={onOpen} style={{ background: 'white', borderRadius: 12, padding: 0, marginBottom: 10, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)', animationDelay: `${Math.min(index * 30, 300)}ms`, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: 64, flexShrink: 0, background: temp.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 6px' }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: temp.color, lineHeight: 1, letterSpacing: '-0.03em' }}>{score}</div>
        <div style={{ fontSize: 9, fontWeight: 800, color: temp.color, marginTop: 4, letterSpacing: '0.05em' }}>{temp.label}</div>
      </div>

      <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.name}</div>
          <ChevronRight size={18} color="#9ca3af" style={{ flexShrink: 0, marginTop: 2 }} />
        </div>

        {lead.vehicle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#4b5563', marginTop: 3, marginBottom: 6 }}>
            <Car size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.vehicle}</span>
          </div>
        )}

        {topSignals.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {topSignals.map((s, i) => (
              <div key={i} style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: '#f0f7fc', color: '#00558C' }}>{s.label}</div>
            ))}
          </div>
        ) : lastNote ? (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Last touch: {lastNote.type} — {fmtRelative(lastNote.date)}</div>
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' }}>No activity yet</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DETAIL VIEW
// ============================================================================
function DetailView({ lead, onBack, onSave, onDelete }) {
  const [showLog, setShowLog] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { score, breakdown } = lead._score;
  const temp = tempLabel(score);

  const logActivity = (type, text) => {
    const note = { id: newId(), type, text: text || '', date: todayISO(), ts: Date.now() };
    onSave({ ...lead, notes: [note, ...(lead.notes || [])] });
    setShowLog(false);
  };

  if (showEdit) {
    return <AddEditView existing={lead} onBack={() => setShowEdit(false)} onSave={(l) => { onSave(l); setShowEdit(false); }} />;
  }

  const recentActivity = lead.notes || [];

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${temp.color} 0%, ${temp.color}dd 100%)`, color: 'white', padding: '14px 18px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={() => setShowEdit(true)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>
            <Edit3 size={14} /> Edit
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 16, padding: '8px 16px', textAlign: 'center', minWidth: 76 }}>
            <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em' }}>{score}</div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', marginTop: 4 }}>{temp.label}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.name}</h2>
            {lead.vehicle && (
              <div style={{ fontSize: 14, opacity: 0.95, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Car size={14} /> {lead.vehicle}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: 'white', padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#00558C', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Activity size={11} /> Why this score
        </div>
        {breakdown.length === 0 ? (
          <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>No signals yet — log activity below to build up the score.</div>
        ) : (
          <div>
            {breakdown.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
                <span style={{ color: b.big ? '#111827' : '#4b5563', fontWeight: b.big ? 600 : 500 }}>
                  {b.big && '⭐ '}{b.label}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: b.pts >= 0 ? '#15803d' : '#dc2626', background: b.pts >= 0 ? '#dcfce7' : '#fee2e2', padding: '2px 8px', borderRadius: 999 }}>
                  {b.pts >= 0 ? '+' : ''}{b.pts}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: 'white', padding: '14px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#00558C', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontStyle: 'italic', padding: '0 4px' }}>Quick actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            { type: 'Call',  Icon: Phone,        href: lead.phone ? `tel:${lead.phone}` : null },
            { type: 'Text',  Icon: MessageSquare,href: lead.phone ? `sms:${lead.phone}` : null },
            { type: 'Email', Icon: Mail,         href: lead.email ? `mailto:${lead.email}` : null },
            { type: 'Test drive', Icon: Key, href: null, hot: true },
          ].map(({ type, Icon, href, hot }) => (
            <button key={type} onClick={() => { if (href) window.location.href = href; setTimeout(() => setShowLog(type), href ? 100 : 0); }} style={{ padding: '12px 4px', borderRadius: 10, border: hot ? '1.5px solid #dc2626' : '1px solid #e5e7eb', background: hot ? '#fee2e2' : 'white', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, color: hot ? '#dc2626' : '#00558C', fontWeight: 700, fontSize: 11 }}>
              <Icon size={18} />
              {type}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 16px', paddingBottom: 100 }}>
        {(lead.phone || lead.email) && (
          <div style={{ background: 'white', borderRadius: 10, padding: '4px 12px', marginBottom: 14 }}>
            {lead.phone && <InfoRow label="Phone" value={fmtPhone(lead.phone)} />}
            {lead.email && <InfoRow label="Email" value={lead.email} />}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: '#00558C', margin: 0, letterSpacing: '0.1em', textTransform: 'uppercase', fontStyle: 'italic' }}>Activity ({recentActivity.length})</h3>
          <button onClick={() => setShowLog(true)} className="btn-primary" style={{ padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={14} strokeWidth={3} /> Log
          </button>
        </div>

        {recentActivity.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13, background: '#f9fafb', borderRadius: 10 }}>
            No activity yet. Log a touch to start scoring.
          </div>
        ) : (
          <div>
            {recentActivity.map(n => {
              const meta = ACTIVITY_TYPES[n.type] || ACTIVITY_TYPES.Note;
              const Icon = meta.icon;
              return (
                <div key={n.id} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: `${meta.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color }}>
                    <Icon size={14} />
                  </div>
                  <div style={{ flex: 1, background: '#f9fafb', padding: 10, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: n.text ? 4 : 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                        {n.type}
                        {meta.points && meta.weight > 0 && (
                          <span style={{ fontSize: 10, color: '#15803d', fontWeight: 700, marginLeft: 6 }}>+{meta.weight}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{fmtDate(n.date)}</span>
                    </div>
                    {n.text && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.45 }}>{n.text}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid #e5e7eb' }}>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} style={{ background: 'transparent', border: 'none', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 8, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={14} /> Remove from hot list
            </button>
          ) : (
            <div style={{ background: '#fef2f2', padding: 14, borderRadius: 10 }}>
              <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 10, fontWeight: 600 }}>Delete this lead?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onDelete(lead.id)} style={{ background: '#dc2626', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Delete</button>
                <button onClick={() => setConfirmDelete(false)} style={{ background: 'white', color: '#374151', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showLog && <LogActivityModal initialType={typeof showLog === 'string' ? showLog : 'Call'} onClose={() => setShowLog(false)} onSave={logActivity} />}
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#111827', fontWeight: 500, textAlign: 'right' }}>{value}</div>
    </div>
  );
}

// ============================================================================
// LOG ACTIVITY MODAL
// ============================================================================
function LogActivityModal({ initialType, onClose, onSave }) {
  const [type, setType] = useState(initialType || 'Call');
  const [text, setText] = useState('');

  const types = Object.entries(ACTIVITY_TYPES).filter(([k]) => k !== 'Note').map(([k, v]) => ({ id: k, ...v }));
  types.push({ id: 'Note', ...ACTIVITY_TYPES.Note });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 500, padding: 20, animation: 'slideUp 0.2s ease-out', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>Log activity</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 14 }}>
          {types.map(t => {
            const Icon = t.icon;
            const active = type === t.id;
            return (
              <button key={t.id} onClick={() => setType(t.id)} style={{ padding: '10px 12px', borderRadius: 8, border: active ? `1.5px solid ${t.color}` : '1px solid #e5e7eb', background: active ? `${t.color}1a` : 'white', color: active ? t.color : '#374151', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
                <Icon size={15} />
                <span style={{ flex: 1 }}>{t.id}</span>
                {t.points && t.weight > 0 && (<span style={{ fontSize: 10, fontWeight: 800, opacity: 0.8 }}>+{t.weight}</span>)}
              </button>
            );
          })}
        </div>

        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="What happened? (optional)" rows={3} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', color: '#111827' }} />

        <button onClick={() => onSave(type, text)} className="btn-primary" style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', marginTop: 12, cursor: 'pointer' }}>
          Save activity
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ADD / EDIT
// ============================================================================
function AddEditView({ existing, onBack, onSave }) {
  const isEdit = !!existing;
  const [form, setForm] = useState(() => existing || {
    id: newId(), name: '', phone: '', email: '', vehicle: '', notes: [], created: todayISO(),
  });
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.name.trim().length > 0;

  return (
    <div>
      <div style={{ background: '#00558C', color: 'white', padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', padding: '8px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>
            <ArrowLeft size={16} /> Cancel
          </button>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{isEdit ? 'Edit lead' : 'New lead'}</h2>
          <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ background: canSave ? 'white' : 'rgba(255,255,255,0.3)', color: canSave ? '#00558C' : 'rgba(255,255,255,0.6)', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13, fontFamily: 'inherit', cursor: canSave ? 'pointer' : 'not-allowed' }}>Save</button>
        </div>
      </div>

      <div style={{ padding: 16, paddingBottom: 80 }}>
        <Field label="Name *" value={form.name} onChange={v => setField('name', v)} placeholder="John Smith" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Phone" value={form.phone} onChange={v => setField('phone', v)} placeholder="(555) 123-4567" type="tel" />
          <Field label="Email" value={form.email} onChange={v => setField('email', v)} placeholder="email@example.com" type="email" />
        </div>
        <Field label="Vehicle interest" value={form.vehicle} onChange={v => setField('vehicle', v)} placeholder="e.g. X5 xDrive40i" />

        {!isEdit && (
          <div style={{ marginTop: 18, padding: 14, background: '#f0f7fc', borderRadius: 10, fontSize: 13, color: '#075985', lineHeight: 1.5 }}>
            That's it. Score builds from logged activity — no status to set, no follow-up dates to manage.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>{label}</label>
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', background: 'white', color: '#111827' }} />
    </div>
  );
}

// ============================================================================
// MENU SHEET
// ============================================================================
const menuItemStyle = { width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 14, border: '1px solid #e5e7eb', borderRadius: 12, background: 'white', fontFamily: 'inherit', marginBottom: 10, textAlign: 'left' };
const menuIconStyle = { width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

function MenuSheet({ onClose, onImport, onExport, totalCount }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 500, padding: 20, animation: 'slideUp 0.2s ease-out' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>Options</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280' }}><X size={20} /></button>
        </div>
        <button onClick={onImport} style={{ ...menuItemStyle, cursor: 'pointer' }}>
          <div style={{ ...menuIconStyle, background: '#e0f2fe', color: '#00558C' }}><Upload size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Import CSV</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Bulk-load from eLead export</div>
          </div>
          <ChevronRight size={18} color="#9ca3af" />
        </button>
        <button onClick={onExport} disabled={totalCount === 0} style={{ ...menuItemStyle, opacity: totalCount === 0 ? 0.5 : 1, cursor: totalCount === 0 ? 'not-allowed' : 'pointer' }}>
          <div style={{ ...menuIconStyle, background: '#dcfce7', color: '#15803d' }}><Download size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Export CSV</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{totalCount === 0 ? 'No leads yet' : `Download ${totalCount} leads with scores`}</div>
          </div>
          <ChevronRight size={18} color="#9ca3af" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// IMPORT VIEW
// ============================================================================
const FIELD_OPTIONS = [
  { value: 'ignore',    label: '— Skip column —' },
  { value: 'fullName',  label: 'Full Name' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName',  label: 'Last Name' },
  { value: 'phone',     label: 'Phone' },
  { value: 'email',     label: 'Email' },
  { value: 'vehicle',   label: 'Vehicle' },
  { value: 'notes',     label: 'Notes' },
];

function ImportView({ onBack, onImport, onDone }) {
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState(null);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  const handleParse = (text) => {
    setParseError('');
    if (!text || !text.trim()) { setParsedRows(null); setColumns([]); return; }
    try {
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
      if (!result.data || result.data.length === 0) { setParseError('No rows found.'); return; }
      const cols = result.meta.fields || Object.keys(result.data[0] || {});
      const auto = {}; cols.forEach(c => { auto[c] = detectFieldForColumn(c); });
      setColumns(cols); setMapping(auto); setParsedRows(result.data);
    } catch (err) { setParseError('Could not read this CSV.'); }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const text = reader.result?.toString() || ''; setCsvText(text); handleParse(text); };
    reader.readAsText(file);
  };

  const hasName = useMemo(() => {
    const m = Object.values(mapping);
    return m.includes('fullName') || m.includes('firstName');
  }, [mapping]);

  const validLeads = useMemo(() => {
    if (!parsedRows || !hasName) return [];
    return parsedRows.map(r => rowToLead(r, mapping)).filter(Boolean);
  }, [parsedRows, mapping, hasName]);

  const doImport = () => setImportResult(onImport(validLeads));

  if (importResult) {
    return (
      <div>
        <div style={{ background: '#00558C', color: 'white', padding: '14px 18px' }}>
          <button onClick={onDone} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', padding: '8px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>
            <ArrowLeft size={16} /> Done
          </button>
        </div>
        <div style={{ padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <Check size={36} color="#15803d" strokeWidth={3} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 8px' }}>Imported {importResult.added} leads</h2>
          {importResult.skipped > 0 && (
            <div style={{ fontSize: 14, color: '#6b7280' }}>Skipped {importResult.skipped} duplicate{importResult.skipped === 1 ? '' : 's'}</div>
          )}
          <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 16, lineHeight: 1.5, maxWidth: 320, margin: '16px auto 0' }}>
            All imported leads start at score 0. Log activity (test drives count most) to push them onto the hot list.
          </div>
          <button onClick={onDone} className="btn-primary" style={{ marginTop: 24, padding: '12px 24px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Go to leads</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: '#00558C', color: 'white', padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', padding: '8px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>
            <ArrowLeft size={16} /> Cancel
          </button>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Import CSV</h2>
          <div style={{ width: 70 }} />
        </div>
      </div>
      <div style={{ padding: 16, paddingBottom: 80 }}>
        {!parsedRows && (
          <div style={{ background: '#e0f2fe', borderRadius: 12, padding: 14, marginBottom: 18, fontSize: 13, color: '#075985', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#00558C' }}>Export from eLead:</div>
            Search → Prospects → filter → Go → Download to Excel → save as CSV → upload here
          </div>
        )}

        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
        <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', padding: 14, borderRadius: 10, border: '2px dashed #00558C', background: '#f0f7fc', color: '#00558C', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
          <FileUp size={18} /> Upload CSV file
        </button>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', margin: '8px 0' }}>or paste CSV</div>
        <textarea value={csvText} onChange={e => { setCsvText(e.target.value); handleParse(e.target.value); }} placeholder="First Name,Last Name,Cell Phone&#10;John,Smith,5551234567" rows={4} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical', boxSizing: 'border-box', color: '#111827' }} />

        {parseError && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={15} /> {parseError}
          </div>
        )}

        {parsedRows && columns.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 11, fontWeight: 700, color: '#00558C', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontStyle: 'italic' }}>Map columns ({parsedRows.length} rows)</h3>
            {!hasName && (
              <div style={{ marginBottom: 10, color: '#dc2626', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={13} /> Map at least a Name column.
              </div>
            )}
            <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              {columns.map((col, i) => (
                <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: i < columns.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</div>
                  <ChevronRight size={14} color="#9ca3af" style={{ flexShrink: 0 }} />
                  <select value={mapping[col] || 'ignore'} onChange={e => setMapping(m => ({ ...m, [col]: e.target.value }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, fontFamily: 'inherit', background: 'white', color: '#111827', minWidth: 130 }}>
                    {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {parsedRows && hasName && validLeads.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: 14, borderTop: '1px solid #e5e7eb', boxShadow: '0 -4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ maxWidth: 500, margin: '0 auto' }}>
            <button onClick={doImport} className="btn-primary" style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Upload size={16} /> Import {validLeads.length} {validLeads.length === 1 ? 'lead' : 'leads'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
