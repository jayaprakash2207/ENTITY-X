import { useState, useEffect } from 'react'
import { Zap, Plus, Trash2, ToggleLeft, ToggleRight, Save, AlertTriangle, Bell, Shield } from 'lucide-react'

const FIELD_OPTIONS = [
  { value: 'risk_level',       label: 'Risk Level',         type: 'select', options: ['LOW','MEDIUM','HIGH'] },
  { value: 'fake_probability', label: 'Fake/AI Probability', type: 'number' },
  { value: 'entity_type',      label: 'Content Type',       type: 'select', options: ['IMAGE','TEXT','VIDEO','AUDIO'] },
  { value: 'source_domain',    label: 'Source Domain',      type: 'text' },
]

const OP_OPTIONS = {
  select: [{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }],
  number: [{ value: 'gt', label: '>' }, { value: 'gte', label: '≥' }, { value: 'lt', label: '<' }, { value: 'lte', label: '≤' }, { value: 'eq', label: '=' }],
  text:   [{ value: 'eq', label: '=' }, { value: 'contains', label: 'contains' }, { value: 'neq', label: '≠' }],
}

const ACTION_OPTIONS = [
  { value: 'notify', label: 'Show Alert Notification', icon: '🔔' },
  { value: 'flag',   label: 'Flag for Review',         icon: '🚩' },
  { value: 'block',  label: 'Block & Notify',          icon: '🛑' },
]

const emptyRule = () => ({
  rule_id: `rule-${Date.now()}`,
  name: '',
  enabled: true,
  condition: { field: 'risk_level', operator: 'eq', value: 'HIGH' },
  action: { type: 'notify', message: '' },
})

const S = {
  page: { minHeight: '100%', color: '#c8d8e8' },
  header: { marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 14 },
  headerIcon: { width: 40, height: 40, borderRadius: 8, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.06em' },
  sub: { fontSize: 11, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 },
  panel: { background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '18px 20px', marginBottom: 16 },
  label: { fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 5, display: 'block' },
  input: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none', width: '100%' },
  select: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none', width: '100%', cursor: 'pointer' },
  btn: (color = '#8b5cf6', disabled = false) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 7, border: `1px solid ${color}50`,
    background: `${color}18`, color, cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', opacity: disabled ? 0.5 : 1,
    textTransform: 'uppercase',
  }),
}

export default function AlertRules() {
  const [rules, setRules] = useState([])
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [recentTriggers, setRecentTriggers] = useState([])

  const load = async () => {
    try { setRules(await window.entityX.alertRulesList() || []) } catch {}
  }

  useEffect(() => {
    load()
    const unsub = window.entityX.onAlertRuleTriggered?.((triggered) => {
      setRecentTriggers(prev => [...triggered.map(t => ({ ...t, ts: Date.now() })), ...prev].slice(0, 20))
    })
    return () => unsub?.()
  }, [])

  const handleSave = async () => {
    if (!draft?.name?.trim()) return
    setSaving(true)
    try { setRules(await window.entityX.alertRulesSave(draft) || []); setDraft(null) }
    catch {} finally { setSaving(false) }
  }

  const handleDelete = async (ruleId) => {
    try { setRules(await window.entityX.alertRulesDelete(ruleId) || []) } catch {}
  }

  const handleToggle = async (rule) => {
    try { setRules(await window.entityX.alertRulesSave({ ...rule, condition: rule.condition, action: rule.action, enabled: !rule.enabled }) || []) }
    catch {}
  }

  const setCondField = (field) => {
    const fieldDef = FIELD_OPTIONS.find(f => f.value === field)
    const defaultOp = fieldDef?.type === 'number' ? 'gt' : 'eq'
    const defaultVal = fieldDef?.type === 'select' ? (fieldDef.options[0] || '') : fieldDef?.type === 'number' ? '0.7' : ''
    setDraft(d => ({ ...d, condition: { field, operator: defaultOp, value: defaultVal } }))
  }

  const fieldDef = draft ? FIELD_OPTIONS.find(f => f.value === draft.condition.field) : null
  const opOptions = fieldDef ? (OP_OPTIONS[fieldDef.type] || OP_OPTIONS.text) : []

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerIcon}><Zap size={18} color="#8b5cf6" /></div>
        <div style={{ flex: 1 }}>
          <div style={S.title}>Alert Rules</div>
          <div style={S.sub}>Automated threat detection rules — fire on any detection event</div>
        </div>
        <button style={S.btn()} onClick={() => setDraft(emptyRule())}>
          <Plus size={13} />New Rule
        </button>
      </div>

      {/* Recent Triggers */}
      {recentTriggers.length > 0 && (
        <div style={{ ...S.panel, borderColor: 'rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.04)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bell size={11} color="#fbbf24" /> Recent Triggers ({recentTriggers.length})
          </div>
          {recentTriggers.slice(0, 5).map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(251,191,36,0.06)', borderRadius: 6, marginBottom: 5, fontSize: 11 }}>
              <AlertTriangle size={12} color="#fbbf24" />
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>{t.name}</span>
              <span style={{ color: '#475569' }}>fired on</span>
              <span style={{ color: '#e2e8f0' }}>{t.detection?.type}</span>
              <span style={{ color: t.detection?.risk === 'HIGH' ? '#f87171' : '#fbbf24' }}>{t.detection?.risk}</span>
              <span style={{ marginLeft: 'auto', color: '#334155', fontSize: 10 }}>{new Date(t.ts).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Rule Builder */}
      {draft && (
        <div style={{ ...S.panel, borderColor: 'rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.04)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 16, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {draft.rule_id && rules.find(r => r.rule_id === draft.rule_id) ? 'Edit Rule' : 'New Rule'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={S.label}>Rule Name</label>
              <input style={S.input} placeholder="e.g. High Risk Image Alert" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            <div>
              <label style={S.label}>Action</label>
              <select style={S.select} value={draft.action.type} onChange={e => setDraft(d => ({ ...d, action: { ...d.action, type: e.target.value } }))}>
                {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Condition — trigger when:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: 10, marginBottom: 14, alignItems: 'end' }}>
            <div>
              <label style={S.label}>Field</label>
              <select style={S.select} value={draft.condition.field} onChange={e => setCondField(e.target.value)}>
                {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Operator</label>
              <select style={S.select} value={draft.condition.operator} onChange={e => setDraft(d => ({ ...d, condition: { ...d.condition, operator: e.target.value } }))}>
                {opOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Value</label>
              {fieldDef?.type === 'select' ? (
                <select style={S.select} value={draft.condition.value} onChange={e => setDraft(d => ({ ...d, condition: { ...d.condition, value: e.target.value } }))}>
                  {(fieldDef.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input style={S.input}
                  type={fieldDef?.type === 'number' ? 'number' : 'text'}
                  step={fieldDef?.type === 'number' ? '0.05' : undefined}
                  min={fieldDef?.type === 'number' ? '0' : undefined}
                  max={fieldDef?.type === 'number' ? '1' : undefined}
                  placeholder={fieldDef?.type === 'number' ? '0.0 – 1.0' : 'value…'}
                  value={draft.condition.value}
                  onChange={e => setDraft(d => ({ ...d, condition: { ...d.condition, value: e.target.value } }))}
                />
              )}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Alert Message (optional)</label>
            <input style={S.input} placeholder="Custom message shown when this rule fires…" value={draft.action.message || ''} onChange={e => setDraft(d => ({ ...d, action: { ...d.action, message: e.target.value } }))} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={S.btn('#8b5cf6', saving || !draft.name.trim())} onClick={handleSave} disabled={saving || !draft.name.trim()}>
              <Save size={12} />{saving ? 'Saving…' : 'Save Rule'}
            </button>
            <button style={S.btn('#475569')} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div style={S.panel}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 14 }}>
          Active Rules ({rules.length})
        </div>
        {rules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <Shield size={32} color="rgba(139,92,246,0.15)" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontSize: 12, color: '#334155' }}>No rules yet. Create your first rule to start automated threat detection.</div>
          </div>
        ) : (
          rules.map(rule => {
            const field = FIELD_OPTIONS.find(f => f.value === rule.condition?.field)
            const action = ACTION_OPTIONS.find(a => a.value === rule.action?.type)
            return (
              <div key={rule.rule_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: rule.enabled ? 'rgba(139,92,246,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${rule.enabled ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, marginBottom: 8 }}>
                <button onClick={() => handleToggle(rule)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: rule.enabled ? '#8b5cf6' : '#334155' }}>
                  {rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: rule.enabled ? '#e2e8f0' : '#475569', marginBottom: 4 }}>{rule.name}</div>
                  <div style={{ fontSize: 10, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '1px 6px', color: '#8b5cf6' }}>
                      {field?.label || rule.condition?.field} {rule.condition?.operator} {rule.condition?.value}
                    </span>
                    <span>→</span>
                    <span style={{ background: 'rgba(251,191,36,0.08)', borderRadius: 4, padding: '1px 6px', color: '#fbbf24' }}>
                      {action?.icon} {action?.label || rule.action?.type}
                    </span>
                    {rule.trigger_count > 0 && (
                      <span style={{ background: 'rgba(248,113,113,0.08)', borderRadius: 4, padding: '1px 6px', color: '#f87171', marginLeft: 4 }}>
                        fired {rule.trigger_count}×
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setDraft({ ...rule, condition: rule.condition, action: rule.action })} style={{ ...S.btn('#8b5cf6'), padding: '5px 10px', fontSize: 10 }}>Edit</button>
                <button onClick={() => handleDelete(rule.rule_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#334155', padding: 4 }}><Trash2 size={14} /></button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
