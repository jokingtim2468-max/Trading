import { useEffect, useRef, useState } from 'react';
import { GripVertical, Minus, X, Undo2 } from 'lucide-react';

const KEY = 'quantbot.terminal.editor';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window */ } };
const swatch = (p) => ({ background: `linear-gradient(135deg, ${p.settings.background} 50%, ${p.settings.up} 50%)` });

// The AI chart editor: a rounded window you drag by its header. It changes only the chart's settings (every change
// is a version you can revert or restore); presets apply in one click.
export default function ChartEditor({ chart, busy, onSend, onPreset, onRevert, onRestore, onClose }) {
  const [pos, setPos] = useState(() => read() || { x: Math.max(16, window.innerWidth - 460), y: Math.max(72, window.innerHeight - 560) });
  const [min, setMin] = useState(false);
  const [draft, setDraft] = useState('');
  const [msgs, setMsgs] = useState([{ who: 'bot', text: 'I edit this chart only: colors, grid, candles and the model lines. Every change is a version you can revert.' }]);
  const drag = useRef(null);
  const list = useRef(null);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      const x = Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - 120);
      const y = Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 60);
      setPos({ x, y });
    };
    const up = () => { if (drag.current) { drag.current = null; setPos((p) => { write(p); return p; }); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setMsgs((m) => [...m, { who: 'me', text }]);
    try {
      const r = await onSend(text);
      setMsgs((m) => [...m, { who: 'bot', text: r.changed ? `${r.say} Saved as v${r.versions.length}.` : r.say }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: 'bot', text: e.message, error: true }]);
    }
  };

  const versions = chart?.versions || [];
  return (
    <div style={{ left: pos.x, top: pos.y }} data-testid="chart-editor"
      className="fixed z-40 w-[400px] rounded-[20px] border border-white/10 bg-[#1e222d]/95 backdrop-blur-xl shadow-[0_28px_70px_rgba(0,0,0,.6)] text-[#d1d4dc] overflow-hidden animate-in fade-in-0 slide-in-from-bottom-2 duration-pop ease-pop calm:animate-none">
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[#2a2e39] cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={(e) => { if (e.target.closest('button')) return; drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; }} data-testid="chart-editor-handle">
        <GripVertical className="w-4 h-4 text-[#5d606b]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">Chart editor</div>
          <div className="text-[11px] text-[#787b86] truncate">Edits this chart only · drag to move</div>
        </div>
        <button type="button" aria-label={min ? 'Expand' : 'Minimize'} onClick={() => setMin((v) => !v)} className="w-7 h-7 rounded-lg border border-[#363a45] flex items-center justify-center hover:bg-[#2a2e39]"><Minus className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Close the chart editor" onClick={onClose} className="w-7 h-7 rounded-lg border border-[#363a45] flex items-center justify-center hover:bg-[#2a2e39]"><X className="w-3.5 h-3.5" /></button>
      </div>
      {!min && (
        <>
          <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 border-b border-[#2a2e39]">
            {(chart?.presets || []).map((p) => (
              <button key={p.id} type="button" onClick={() => onPreset(p.id).then(() => setMsgs((m) => [...m, { who: 'bot', text: `Preset: ${p.name}.` }]))}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#363a45] text-xs hover:bg-[#2a2e39] transition-colors" data-testid={`editor-preset-${p.id}`}>
                <span className="w-3 h-3 rounded-[4px] border border-[#4a4e59]" style={swatch(p)} />{p.name}
              </button>
            ))}
          </div>
          <div ref={list} className="h-60 overflow-y-auto px-3.5 py-3 flex flex-col gap-2">
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[85%] px-3 py-2 text-[13px] leading-snug animate-in fade-in-0 slide-in-from-bottom-1 duration-pop calm:animate-none ${m.who === 'me'
                ? 'self-end rounded-[14px_14px_4px_14px] bg-[#2962ff] text-white'
                : `self-start rounded-[14px_14px_14px_4px] bg-[#2a2e39] ${m.error ? 'text-[#f23645]' : ''}`}`}>{m.text}</div>
            ))}
            {busy && <div className="self-start px-3 py-2 rounded-[14px] bg-[#2a2e39] text-[13px] text-[#787b86]">Thinking…</div>}
          </div>
          <div className="flex items-center gap-1.5 px-3.5 py-2 border-t border-[#2a2e39] overflow-x-auto">
            <span className="text-[11px] text-[#787b86] shrink-0">Versions</span>
            {versions.slice(-5).map((v) => (
              <button key={v.n} type="button" title={v.note} onClick={() => v.n !== versions.length && onRestore(v.n)}
                className={`shrink-0 px-2 py-0.5 rounded-full border border-[#363a45] text-[11px] ${v.n === versions.length ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`}>v{v.n}{v.n === versions.length ? ' now' : ''}</button>
            ))}
            <button type="button" onClick={onRevert} disabled={versions.length < 2} data-testid="editor-revert"
              className="ml-auto shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full border border-[#363a45] text-xs hover:bg-[#2a2e39] disabled:opacity-40"><Undo2 className="w-3 h-3" />Revert</button>
          </div>
          <div className="flex gap-2 px-3.5 pb-3.5 pt-2.5">
            <label htmlFor="chart-editor-input" className="sr-only">Ask the chart editor for a change</label>
            <input id="chart-editor-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="e.g. black background, white candles, hide grid"
              className="flex-1 h-10 px-3 rounded-xl bg-[#131722] border border-[#363a45] text-sm outline-none focus:border-[#2962ff]" data-testid="chart-editor-input" />
            <button type="button" onClick={send} disabled={busy || !draft.trim()} className="h-10 px-4 rounded-xl bg-[#2962ff] text-white text-sm font-semibold disabled:opacity-50" data-testid="chart-editor-send">Send</button>
          </div>
        </>
      )}
    </div>
  );
}
