import { useState, useRef } from 'react';

const API = 'http://127.0.0.1:8000';

function RiskBadge({ level }) {
  const colors = { HIGH: '#dc2626', MEDIUM: '#d97706', LOW: '#16a34a' };
  const bg     = colors[level] || '#475569';
  return (
    <span style={{ background: bg, color: '#fff', borderRadius: '99px',
                   padding: '2px 10px', fontSize: '12px', fontWeight: 700 }}>
      {level || 'N/A'}
    </span>
  );
}

function ScoreBar({ value, label }) {
  const pct   = Math.round((value || 0) * 100);
  const color = pct >= 60 ? '#dc2626' : pct >= 35 ? '#d97706' : '#16a34a';
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '12px', fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ background: '#0f172a', borderRadius: '4px', height: '6px' }}>
        <div style={{ background: color, width: `${pct}%`, height: '6px', borderRadius: '4px', transition: 'width .4s' }} />
      </div>
    </div>
  );
}

export default function PDFAnalyzer() {
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  async function analyzeFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${API}/api/analyze/pdf`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(await r.text());
      setResult(await r.json());
    } catch (err) {
      setError(err.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) analyzeFile(file);
  }

  return (
    <div style={{ padding: '24px', maxWidth: '860px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>PDF Forgery Detector</h1>
      <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
        Detect AI-generated, tampered, or forged PDF documents
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? '#7c3aed' : '#334155'}`, borderRadius: '12px',
                 padding: '40px', textAlign: 'center', cursor: 'pointer', marginBottom: '20px',
                 background: dragging ? 'rgba(124,58,237,0.08)' : '#1e293b', transition: 'all .2s' }}>
        <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
          onChange={e => analyzeFile(e.target.files[0])} />
        <div style={{ fontSize: '36px', marginBottom: '10px' }}>📄</div>
        <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '15px' }}>
          {loading ? 'Analysing…' : 'Drop a PDF here or click to browse'}
        </div>
        <div style={{ color: '#475569', fontSize: '12px', marginTop: '6px' }}>Supports PDF up to 50 MB</div>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '8px',
                      padding: '10px 14px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '32px', color: '#7c3aed', fontSize: '14px' }}>
          Running forensic analysis…
        </div>
      )}

      {result && !loading && (
        <div>
          {/* Summary card */}
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9' }}>Analysis Result</h3>
              <RiskBadge level={result.risk_level} />
            </div>
            <ScoreBar value={result.fake_probability}  label="Forgery / AI-Generation Probability" />
            <ScoreBar value={result.ai_vocab_score}    label="AI Vocabulary Score" />
            <div style={{ display: 'flex', gap: '12px', marginTop: '14px' }}>
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: result.is_ai_generated ? '#dc2626' : '#16a34a' }}>
                  {result.is_ai_generated ? 'Yes' : 'No'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>AI Generated</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: result.structure_ok ? '#16a34a' : '#dc2626' }}>
                  {result.structure_ok ? 'OK' : 'Issues'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Structure</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#e2e8f0' }}>
                  {(result.file_size_bytes / 1024).toFixed(1)} KB
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>File Size</div>
              </div>
            </div>
          </div>

          {/* Findings */}
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '13px', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '12px' }}>
              Forensic Findings
            </h3>
            <ul style={{ paddingLeft: '16px', margin: 0 }}>
              {result.findings.map((f, i) => (
                <li key={i} style={{ color: '#e2e8f0', fontSize: '13px', marginBottom: '6px' }}>{f}</li>
              ))}
            </ul>
          </div>

          {/* Metadata */}
          {Object.keys(result.metadata || {}).length > 0 && (
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '13px', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '12px' }}>
                Document Metadata
              </h3>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                {Object.entries(result.metadata).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '5px 12px 5px 0', color: '#94a3b8', width: '140px' }}>{k}</td>
                    <td style={{ padding: '5px 0', color: '#e2e8f0' }}>{v}</td>
                  </tr>
                ))}
              </table>
            </div>
          )}

          {/* AI vocab words */}
          {result.matched_ai_words?.length > 0 && (
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px' }}>
              <h3 style={{ fontSize: '13px', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '12px' }}>
                AI Vocabulary Matches
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {result.matched_ai_words.map(w => (
                  <span key={w} style={{ background: '#450a0a', color: '#fca5a5', borderRadius: '99px',
                                         padding: '3px 10px', fontSize: '12px', fontWeight: 600 }}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
