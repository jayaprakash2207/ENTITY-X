"""Tests for backend.legal.guidance"""
import pytest

from backend.legal.guidance import build_legal_output, LegalOutput


class TestBuildLegalOutput:

    def test_returns_legal_output_instance(self):
        result = build_legal_output(entity_id="e1")
        assert isinstance(result, LegalOutput)

    def test_output_has_all_fields(self):
        result = build_legal_output(entity_id="e2")
        assert isinstance(result.complaint_draft, str)
        assert isinstance(result.evidence_summary, dict)
        assert isinstance(result.disclaimer, str)

    def test_entity_id_in_complaint_draft(self):
        result = build_legal_output(entity_id="case-42")
        assert "case-42" in result.complaint_draft

    def test_source_url_in_complaint_draft(self):
        result = build_legal_output(
            entity_id="e3",
            source_url="https://example.com/fake-video",
        )
        assert "example.com" in result.complaint_draft

    def test_high_risk_reflected_in_output(self):
        result = build_legal_output(
            entity_id="e4",
            misinformation_risk="HIGH",
            fake_probability=0.95,
            forensic_findings=["Lip sync mismatch", "Facial artefacts detected"],
        )
        assert len(result.complaint_draft) > 0
        assert "HIGH" in result.complaint_draft or "high" in result.complaint_draft.lower()

    def test_evidence_summary_contains_entity_id(self):
        result = build_legal_output(entity_id="ent-99")
        assert result.evidence_summary.get("entity_id") == "ent-99"

    def test_evidence_summary_contains_key_fields(self):
        result = build_legal_output(
            entity_id="e5",
            ai_generated_probability=0.8,
            misinformation_risk="MEDIUM",
            credibility_score=0.4,
        )
        summary = result.evidence_summary
        assert "ai_generated_probability" in summary or "entity_id" in summary

    def test_disclaimer_is_non_empty(self):
        result = build_legal_output()
        assert len(result.disclaimer) > 0

    def test_forensic_findings_in_complaint(self):
        result = build_legal_output(
            entity_id="e6",
            forensic_findings=["GAN fingerprint present", "Noise inconsistency"],
        )
        assert "GAN fingerprint present" in result.complaint_draft

    def test_key_claims_in_complaint(self):
        result = build_legal_output(
            entity_id="e7",
            key_claims=["Leader said X", "Election was rigged"],
        )
        assert "Leader said X" in result.complaint_draft

    def test_none_probabilities_handled_gracefully(self):
        result = build_legal_output(
            entity_id="e8",
            ai_generated_probability=None,
            fake_probability=None,
            credibility_score=None,
        )
        assert isinstance(result.complaint_draft, str)

    def test_image_entity_type(self):
        result = build_legal_output(entity_id="e9", entity_type="IMAGE")
        assert "IMAGE" in result.complaint_draft or "image" in result.complaint_draft.lower()

    def test_text_entity_type(self):
        result = build_legal_output(entity_id="e10", entity_type="TEXT")
        assert isinstance(result.complaint_draft, str)
