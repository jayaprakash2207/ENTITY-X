"""Tests for backend.legal.judge_report"""
import pytest

from backend.legal.judge_report import (
    JudgeReportInput,
    generate_judge_report,
    _pct,
    _risk_color,
    _ts,
)


class TestHelpers:

    def test_pct_formats_float(self):
        assert _pct(0.75) == "75.0%"
        assert _pct(0.0) == "0.0%"
        assert _pct(1.0) == "100.0%"

    def test_pct_none_returns_na(self):
        assert _pct(None) == "N/A"

    def test_risk_color_high(self):
        assert _risk_color("HIGH") == "#dc2626"

    def test_risk_color_medium(self):
        assert _risk_color("MEDIUM") == "#d97706"

    def test_risk_color_low(self):
        assert _risk_color("LOW") == "#16a34a"

    def test_risk_color_unknown_returns_gray(self):
        color = _risk_color("UNKNOWN")
        assert color == "#64748b"

    def test_risk_color_none(self):
        assert _risk_color(None) == "#64748b"

    def test_ts_none_returns_na(self):
        assert _ts(None) == "N/A"

    def test_ts_formats_epoch(self):
        result = _ts(1_000_000_000_000)  # 2001-09-09
        assert "2001" in result


class TestGenerateJudgeReport:

    def _minimal_input(self, **kwargs):
        return JudgeReportInput(entity_id="test-001", **kwargs)

    def test_returns_string(self):
        inp = self._minimal_input()
        result = generate_judge_report(inp)
        assert isinstance(result, str)

    def test_output_is_html(self):
        inp = self._minimal_input()
        result = generate_judge_report(inp)
        assert result.strip().startswith("<!DOCTYPE html>")
        assert "</html>" in result

    def test_entity_id_in_output(self):
        inp = self._minimal_input()
        result = generate_judge_report(inp)
        assert "test-001" in result

    def test_risk_badge_present(self):
        inp = self._minimal_input(misinformation_risk="HIGH")
        result = generate_judge_report(inp)
        assert "HIGH RISK" in result

    def test_forensic_findings_rendered(self):
        inp = self._minimal_input(forensic_findings=["Pixel manipulation detected", "Metadata mismatch"])
        result = generate_judge_report(inp)
        assert "Pixel manipulation detected" in result
        assert "Metadata mismatch" in result

    def test_key_claims_rendered(self):
        inp = self._minimal_input(key_claims=["Claim A is false", "Source is unverified"])
        result = generate_judge_report(inp)
        assert "Claim A is false" in result

    def test_provenance_chain_table_rendered(self):
        chain = [{"domain": "example.com", "provenance_standard": "C2PA", "seen_count": 3, "first_seen": 0}]
        inp = self._minimal_input(provenance_chain=chain)
        result = generate_judge_report(inp)
        assert "example.com" in result
        assert "C2PA" in result

    def test_no_provenance_shows_placeholder(self):
        inp = self._minimal_input(provenance_chain=[])
        result = generate_judge_report(inp)
        assert "No provenance chain data available" in result

    def test_legal_complaint_rendered(self):
        inp = self._minimal_input(legal_complaint="To Whom It May Concern: This is evidence.")
        result = generate_judge_report(inp)
        assert "To Whom It May Concern" in result

    def test_no_legal_complaint_shows_placeholder(self):
        inp = self._minimal_input(legal_complaint=None)
        result = generate_judge_report(inp)
        assert "No legal complaint draft available" in result

    def test_xss_escaping(self):
        inp = self._minimal_input(content_title='<script>alert("xss")</script>')
        result = generate_judge_report(inp)
        assert "<script>" not in result
        assert "&lt;script&gt;" in result

    def test_generator_fingerprint_rendered(self):
        gf = {"generator": "Stable Diffusion", "confidence": 0.88, "is_ai_generated": True, "evidence": ["smooth skin"]}
        inp = self._minimal_input(generator_fingerprint=gf)
        result = generate_judge_report(inp)
        assert "Stable Diffusion" in result
        assert "88.0%" in result

    def test_no_generator_shows_placeholder(self):
        inp = self._minimal_input(generator_fingerprint=None)
        result = generate_judge_report(inp)
        assert "No generator fingerprint analysis performed" in result

    def test_disclaimer_present(self):
        inp = self._minimal_input()
        result = generate_judge_report(inp)
        assert "Disclaimer" in result
