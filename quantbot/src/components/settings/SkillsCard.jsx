import { useEffect, useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';

const call = (body) => client.functions.invoke('skills', body).then((r) => r.data);
const field = 'w-full rounded-md border border-border bg-background px-2 text-sm';

// Settings > Skills: instructions the local model loads only when a task needs them (load_skill). Built-in skills
// cover backtesting rules, MT5 data, prop firm rules, contracts, Pine v6, MQL5, ML and past research; yours are
// added here and override a built-in skill with the same name.
export default function SkillsCard() {
  const [skills, setSkills] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { call({ action: 'list' }).then((r) => setSkills(r.skills)).catch((e) => setMsg(e.message)); }, []);
  const open = async (name) => { const s = await call({ action: 'get', name }); setEdit({ name: s.name, description: s.description, body: s.body }); };
  const save = async () => { setMsg(''); try { const r = await call({ action: 'save', skill: edit }); setSkills(r.skills); setEdit(null); setMsg('Saved.'); } catch (e) { setMsg(e.message); } };
  const remove = async (name) => { try { const r = await call({ action: 'remove', name }); setSkills(r.skills); } catch (e) { setMsg(e.message); } };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4" data-testid="skills-card">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Skills</h3>
        <span className="text-xs text-muted-foreground">Rules the model loads only when a task needs them</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEdit({ name: '', description: '', body: '' })}>New skill</Button>
      </div>
      <ul className="divide-y divide-border text-sm">
        {skills.map((s) => (
          <li key={s.name} className="flex items-center gap-3 py-2">
            <button type="button" className="shrink-0 whitespace-nowrap font-mono text-primary hover:underline" onClick={() => open(s.name)}>{s.name}</button>
            <span className="text-xs text-muted-foreground truncate">{s.description}</span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{s.source}</span>
            {s.source === 'yours' && <Button size="sm" variant="ghost" onClick={() => remove(s.name)} aria-label={`Delete ${s.name}`}><Trash2 className="w-4 h-4" /></Button>}
          </li>
        ))}
      </ul>
      {edit && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <input className={`${field} h-9`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="skill-name" data-testid="skill-name" />
          <input className={`${field} h-9`} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="One line: when should the model load this skill?" data-testid="skill-description" />
          <textarea className={`${field} h-64 py-2 font-mono`} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder="The instructions (Markdown)" data-testid="skill-body" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} data-testid="skill-save">Save as your skill</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Saving a built-in skill under the same name replaces it with your version; delete yours to go back.</p>
        </div>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
