import { useState } from 'react';
import { Award, Copy, CheckCircle, Globe, Code } from 'lucide-react';

const BADGE_STYLES = [
  { id: 'verified', label: 'Verified Human', color: '#34d399', text: 'VERIFIED HUMAN' },
  { id: 'warning', label: 'Medium Risk', color: '#fbbf24', text: 'AI POSSIBLE' },
  { id: 'danger', label: 'High Risk', color: '#f87171', text: 'HIGH RISK AI' },
];

function BadgePreview({ style, size = 'md' }) {
  const sizes = { sm: { w: 130, h: 18, f: 9 }, md: { w: 160, h: 22, f: 10 }, lg: { w: 200, h: 28, f: 13 } };
  const s = sizes[size];
  return (
    <svg width={s.w} height={s.h} style={{ borderRadius: 4 }}>
      <rect width={s.w} height={s.h} rx="3" fill="#111120" />
      <rect x="0" y="0" width={s.w * 0.45} height={s.h} rx="3" fill="rgba(139,92,246,0.15)" />
      <text x={s.w * 0.225} y={s.h * 0.72} fontFamily="Arial,sans-serif" fontSize={s.f} fill="#a78bfa" textAnchor="middle" fontWeight="bold">Entity X</text>
      <text x={s.w * 0.725} y={s.h * 0.72} fontFamily="Arial,sans-serif" fontSize={s.f} fill={style.color} textAnchor="middle" fontWeight="bold">{style.text}</text>
    </svg>
  );
}

export default function TrustBadge() {
  const [url, setUrl] = useState('');
  const [badgeStyle, setBadgeStyle] = useState('verified');
  const [badgeSize, setBadgeSize] = useState('md');
  const [format, setFormat] = useState('html');
  const [copied, setCopied] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);

  const currentStyle = BADGE_STYLES.find(b => b.id === badgeStyle);

  const analyzeAndSuggest = async () => {
    if (!url.trim()) return;
    setAnalyzing(true);
    try {
      const res = await window.entityX.analyzeUrl(url);
      if (res?.risk_level === 'HIGH') setBadgeStyle('danger');
      else if (res?.risk_level === 'MEDIUM') setBadgeStyle('warning');
      else setBadgeStyle('verified');
      setAnalysisResult(res);
    } catch (e) { console.error(e); } finally { setAnalyzing(false); }
  };

  const getEmbedCode = () => {
    const enc = encodeURIComponent(url || 'https://example.com');
    const apiUrl = `http://127.0.0.1:8000/api/badge/${enc}`;
    if (format === 'html') return `<!-- Entity X Trust Badge -->\n<a href="https://entityx.io/verify?url=${enc}" target="_blank">\n  <img src="${apiUrl}" alt="Entity X Trust Badge" style="height:22px;border-radius:4px;" />\n</a>`;
    if (format === 'markdown') return `[![Entity X Trust Badge](${apiUrl})](https://entityx.io/verify?url=${enc})`;
    return `<script src="https://entityx.io/badge.js" data-url="${url || 'https://example.com'}" data-size="${badgeSize}"></script>`;
  };

  const copyCode = () => {
    navigator.clipboard.writeText(getEmbedCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const riskColor = (r) => r === 'HIGH' ? '#f87171' : r === 'MEDIUM' ? '#fbbf24' : '#34d399';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Award size={20} color="#8b5cf6" /></div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>Embeddable Trust Badge</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Add a "Verified Human Content" badge to any website or article</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 14 }}>Article / Page URL</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input placeholder="https://yoursite.com/article" value={url} onChange={e => setUrl(e.target.value)}
                style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#f1f5f9', fontSize: 13 }} />
              <button onClick={analyzeAndSuggest} disabled={analyzing}
                style={{ background: analyzing ? '#334155' : '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: analyzing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Globe size={14} /> {analyzing ? '...' : 'Auto-Detect'}
              </button>
            </div>
            {analysisResult && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: `${riskColor(analysisResult.risk_level)}0f`, border: `1px solid ${riskColor(analysisResult.risk_level)}33`, fontSize: 12, color: '#94a3b8' }}>
                Analysis: <span style={{ color: riskColor(analysisResult.risk_level), fontWeight: 700 }}>{analysisResult.risk_level}</span> — Badge style auto-selected
              </div>
            )}
          </div>

          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 14 }}>Badge Style</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              {BADGE_STYLES.map(s => (
                <button key={s.id} onClick={() => setBadgeStyle(s.id)}
                  style={{ flex: 1, padding: '12px 8px', borderRadius: 10, border: `2px solid ${badgeStyle === s.id ? s.color : 'var(--border)'}`, background: badgeStyle === s.id ? `${s.color}0f` : 'var(--surface)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <BadgePreview style={s} size="sm" />
                  <span style={{ fontSize: 11, color: badgeStyle === s.id ? s.color : '#64748b', fontWeight: badgeStyle === s.id ? 700 : 400 }}>{s.label}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['sm','md','lg'].map(sz => (
                <button key={sz} onClick={() => setBadgeSize(sz)}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${badgeSize === sz ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`, background: badgeSize === sz ? 'rgba(139,92,246,0.1)' : 'transparent', color: badgeSize === sz ? '#a78bfa' : '#64748b', fontSize: 12, cursor: 'pointer', fontWeight: badgeSize === sz ? 700 : 400 }}>
                  {sz.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 14 }}>Embed Format</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[['html','HTML'],['markdown','Markdown'],['script','Script Tag']].map(([f, l]) => (
                <button key={f} onClick={() => setFormat(f)}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${format === f ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`, background: format === f ? 'rgba(139,92,246,0.1)' : 'transparent', color: format === f ? '#a78bfa' : '#64748b', fontSize: 12, cursor: 'pointer', fontWeight: format === f ? 700 : 400 }}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{ position: 'relative' }}>
              <pre style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, fontSize: 11, color: '#94a3b8', overflow: 'auto', margin: 0, border: '1px solid var(--border)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {getEmbedCode()}
              </pre>
              <button onClick={copyCode}
                style={{ position: 'absolute', top: 10, right: 10, background: copied ? 'rgba(52,211,153,0.15)' : 'rgba(139,92,246,0.15)', border: `1px solid ${copied ? 'rgba(52,211,153,0.3)' : 'rgba(139,92,246,0.3)'}`, borderRadius: 8, padding: '6px 12px', color: copied ? '#34d399' : '#a78bfa', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 20 }}>Live Preview</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
              {['sm','md','lg'].map(sz => (
                <div key={sz} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <BadgePreview style={currentStyle} size={sz} />
                  <span style={{ fontSize: 10, color: '#475569' }}>{sz.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--card)', borderRadius: 14, padding: 20, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9', marginBottom: 12 }}>How it works</div>
            {['Paste embed code on your website or article', 'Badge shows Entity X verification status', 'Readers can click badge to see full analysis', 'Update badge anytime by re-analyzing the URL'].map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#8b5cf6' }}>{i + 1}</div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{step}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
