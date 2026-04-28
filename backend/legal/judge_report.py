"""
backend.legal.judge_report – "Explain to a Judge" structured evidence report.

Generates a self-contained HTML report (printable to PDF via browser)
containing all forensic evidence, trust scores, provenance data, and
legal context for a detected entity.

No extra dependencies — uses Python's built-in html module only.
"""
from __future__ import annotations

import html
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class JudgeReportInput:
    entity_id:                 str
    entity_type:               str                   = "UNKNOWN"
    source_url:                str                   = ""
    content_title:             str                   = ""
    detected_at:               int | None            = None
    fake_probability:          float | None          = None
    ai_generated_probability:  float | None          = None
    misinformation_risk:       str | None            = None
    credibility_score:         float | None          = None
    trust_score:               float | None          = None
    forensic_findings:         list[str]             = field(default_factory=list)
    key_claims:                list[str]             = field(default_factory=list)
    ai_summary:                str | None            = None
    provenance:                dict | None           = None
    provenance_chain:          list[dict]            = field(default_factory=list)
    generator_fingerprint:     dict | None           = None
    confidence_timeline:       list[dict]            = field(default_factory=list)
    legal_complaint:           str | None            = None


def _pct(v: float | None) -> str:
    return f"{v*100:.1f}%" if v is not None else "N/A"


def _risk_color(level: str | None) -> str:
    return {"HIGH": "#dc2626", "MEDIUM": "#d97706", "LOW": "#16a34a"}.get(
        (level or "").upper(), "#64748b"
    )


def _ts(ms: int | None) -> str:
    if not ms:
        return "N/A"
    return time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(ms / 1000))


def _escape(s: Any) -> str:
    return html.escape(str(s or ""))


def _timeline_bars(timeline: list[dict]) -> str:
    if not timeline:
        return "<p style='color:#94a3b8'>No timeline data recorded.</p>"
    items = timeline[-20:]  # show last 20 entries
    bars = []
    for entry in items:
        score  = entry.get("score", 0)
        ts     = _ts(entry.get("recorded_at"))
        stype  = _escape(entry.get("score_type", "score"))
        color  = "#dc2626" if score >= 0.6 else "#d97706" if score >= 0.35 else "#16a34a"
        width  = int(score * 100)
        bars.append(f"""
          <div style="margin:4px 0">
            <span style="font-size:11px;color:#94a3b8;display:inline-block;width:170px">{ts}</span>
            <div style="display:inline-block;background:{color};width:{width}%;height:14px;border-radius:3px;vertical-align:middle"></div>
            <span style="font-size:11px;color:#cbd5e1;margin-left:6px">{score:.2f} ({stype})</span>
          </div>""")
    return "".join(bars)


def generate_judge_report(inp: JudgeReportInput) -> str:
    """
    Return a self-contained HTML string suitable for display in a webview
    or printing to PDF via the browser's print dialog.
    """
    detected_ts = _ts(inp.detected_at)
    now_ts      = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    risk_color  = _risk_color(inp.misinformation_risk)

    # Forensic findings list
    findings_html = "".join(
        f"<li style='margin:4px 0;color:#e2e8f0'>{_escape(f)}</li>"
        for f in inp.forensic_findings
    ) or "<li style='color:#94a3b8'>No forensic findings recorded.</li>"

    # Key claims
    claims_html = "".join(
        f"<li style='margin:4px 0;color:#e2e8f0'>{_escape(c)}</li>"
        for c in inp.key_claims
    ) or "<li style='color:#94a3b8'>No key claims extracted.</li>"

    # Provenance chain table
    if inp.provenance_chain:
        chain_rows = "".join(f"""
          <tr>
            <td style='padding:6px 10px;border-bottom:1px solid #334155'>{_escape(r.get('domain',''))}</td>
            <td style='padding:6px 10px;border-bottom:1px solid #334155'>{_escape(r.get('provenance_standard') or 'None')}</td>
            <td style='padding:6px 10px;border-bottom:1px solid #334155'>{r.get('seen_count',1)}</td>
            <td style='padding:6px 10px;border-bottom:1px solid #334155;font-size:11px'>{_ts(r.get('first_seen'))}</td>
          </tr>""" for r in inp.provenance_chain)
        provenance_section = f"""
          <table style='width:100%;border-collapse:collapse;font-size:13px'>
            <thead><tr style='background:#1e293b'>
              <th style='padding:8px 10px;text-align:left;color:#94a3b8'>Domain</th>
              <th style='padding:8px 10px;text-align:left;color:#94a3b8'>Standard</th>
              <th style='padding:8px 10px;text-align:left;color:#94a3b8'>Times Seen</th>
              <th style='padding:8px 10px;text-align:left;color:#94a3b8'>First Seen</th>
            </tr></thead>
            <tbody>{chain_rows}</tbody>
          </table>"""
    else:
        provenance_section = "<p style='color:#94a3b8'>No provenance chain data available.</p>"

    # Generator fingerprint
    if inp.generator_fingerprint:
        gf = inp.generator_fingerprint
        gen_html = f"""
          <p><strong>Likely Generator:</strong> {_escape(gf.get('generator','Unknown'))}</p>
          <p><strong>Confidence:</strong> {_pct(gf.get('confidence'))}</p>
          <p><strong>AI Generated:</strong> {'Yes' if gf.get('is_ai_generated') else 'No'}</p>
          <ul>{''.join(f"<li style='color:#e2e8f0'>{_escape(e)}</li>" for e in gf.get('evidence',[]))}</ul>"""
    else:
        gen_html = "<p style='color:#94a3b8'>No generator fingerprint analysis performed.</p>"

    # Legal complaint block
    complaint_html = (
        f"<pre style='white-space:pre-wrap;font-size:12px;color:#e2e8f0;background:#0f172a;padding:16px;border-radius:6px'>{_escape(inp.legal_complaint)}</pre>"
        if inp.legal_complaint
        else "<p style='color:#94a3b8'>No legal complaint draft available.</p>"
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Entity X — Evidence Report for {_escape(inp.entity_id)}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px; }}
    h1 {{ font-size: 22px; color: #f8fafc; margin-bottom: 4px; }}
    h2 {{ font-size: 15px; color: #94a3b8; font-weight: 500; margin-bottom: 24px; }}
    h3 {{ font-size: 13px; color: #7c3aed; text-transform: uppercase; letter-spacing: .08em; margin: 28px 0 10px; }}
    .card {{ background: #1e293b; border-radius: 10px; padding: 20px; margin-bottom: 20px; }}
    .badge {{ display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }}
    .metric {{ display: inline-block; background: #0f172a; border-radius: 8px; padding: 10px 18px; margin: 6px 6px 6px 0; }}
    .metric .val {{ font-size: 24px; font-weight: 700; }}
    .metric .lbl {{ font-size: 11px; color: #64748b; margin-top: 2px; }}
    ul {{ padding-left: 18px; }}
    table {{ width: 100%; border-collapse: collapse; }}
    @media print {{
      body {{ background: #fff; color: #000; }}
      .card {{ background: #f8f9fa; border: 1px solid #dee2e6; }}
    }}
  </style>
</head>
<body>

<div style="display:flex;align-items:center;margin-bottom:28px">
  <div style="background:#7c3aed;color:#fff;font-weight:700;font-size:18px;padding:8px 16px;border-radius:8px;margin-right:16px">ENTITY X</div>
  <div>
    <h1>Digital Evidence Report</h1>
    <h2>Case Reference: {_escape(inp.entity_id)} &nbsp;·&nbsp; Generated: {now_ts}</h2>
  </div>
</div>

<div class="card">
  <h3>Subject Information</h3>
  <table style="font-size:13px">
    <tr><td style="color:#94a3b8;padding:4px 16px 4px 0;width:160px">Content Title</td><td>{_escape(inp.content_title or 'N/A')}</td></tr>
    <tr><td style="color:#94a3b8;padding:4px 16px 4px 0">Content Type</td><td>{_escape(inp.entity_type)}</td></tr>
    <tr><td style="color:#94a3b8;padding:4px 16px 4px 0">Source URL</td><td style="word-break:break-all"><a href="{_escape(inp.source_url)}" style="color:#818cf8">{_escape(inp.source_url or 'N/A')}</a></td></tr>
    <tr><td style="color:#94a3b8;padding:4px 16px 4px 0">First Detected</td><td>{detected_ts}</td></tr>
  </table>
</div>

<div class="card">
  <h3>Risk Assessment</h3>
  <div>
    <div class="metric">
      <div class="val" style="color:#dc2626">{_pct(inp.fake_probability)}</div>
      <div class="lbl">Fake Probability</div>
    </div>
    <div class="metric">
      <div class="val" style="color:#f59e0b">{_pct(inp.ai_generated_probability)}</div>
      <div class="lbl">AI-Generated Probability</div>
    </div>
    <div class="metric">
      <div class="val" style="color:#818cf8">{_pct(inp.credibility_score)}</div>
      <div class="lbl">Credibility Score</div>
    </div>
    <div class="metric">
      <div class="val" style="color:#34d399">{f"{inp.trust_score:.1f}/100" if inp.trust_score is not None else "N/A"}</div>
      <div class="lbl">Trust Score</div>
    </div>
  </div>
  <div style="margin-top:14px">
    <span class="badge" style="background:{risk_color};color:#fff">
      {_escape((inp.misinformation_risk or 'UNKNOWN').upper())} RISK
    </span>
  </div>
</div>

<div class="card">
  <h3>Forensic Findings</h3>
  <ul>{findings_html}</ul>
</div>

<div class="card">
  <h3>Key Claims Identified</h3>
  <ul>{claims_html}</ul>
  {f'<p style="margin-top:12px;font-size:13px;color:#94a3b8"><em>AI Summary:</em> {_escape(inp.ai_summary)}</p>' if inp.ai_summary else ''}
</div>

<div class="card">
  <h3>Confidence Score Timeline</h3>
  {_timeline_bars(inp.confidence_timeline)}
</div>

<div class="card">
  <h3>Provenance & Spread Chain</h3>
  {provenance_section}
</div>

<div class="card">
  <h3>AI Generator Fingerprint</h3>
  {gen_html}
</div>

<div class="card">
  <h3>Legal Complaint Draft</h3>
  {complaint_html}
</div>

<div style="margin-top:32px;padding:16px;border-top:1px solid #1e293b;font-size:11px;color:#475569">
  <strong>Disclaimer:</strong> This report is generated by Entity X automated forensic software for informational purposes only.
  It does not constitute legal advice. Findings should be reviewed by a qualified professional before any legal action is taken.
  Detection scores are probabilistic estimates and may contain errors.
  Report generated: {now_ts}
</div>

</body>
</html>"""
