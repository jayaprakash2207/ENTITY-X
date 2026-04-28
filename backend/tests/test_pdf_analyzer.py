"""Tests for backend.forensic.pdf_analyzer"""
import pytest
from backend.forensic.pdf_analyzer import analyze_pdf, _extract_metadata, _ai_vocab_score, _check_structure


MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
    b"xref\n0 4\n0000000000 65535 f\n"
    b"trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n9\n%%EOF"
)

AI_VOCAB_PDF = (
    b"%PDF-1.4\n"
    b"BT (In the realm of contemporary discourse, it is imperative to delve into "
    b"the multifaceted and nuanced tapestry of transformative paradigms. "
    b"Furthermore, it is worth noting that holistic approaches underscore robust synergies.) Tj ET\n"
    b"xref\ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF"
)


class TestCheckStructure:

    def test_valid_pdf_structure(self):
        ok, issues = _check_structure(MINIMAL_PDF)
        assert ok is True
        assert len(issues) == 0

    def test_missing_header(self):
        ok, issues = _check_structure(b"not a pdf")
        assert ok is False
        assert any("header" in i.lower() for i in issues)

    def test_missing_eof(self):
        data = b"%PDF-1.4\nxref\nstartxref\n9\n"
        ok, issues = _check_structure(data)
        assert ok is False
        assert any("eof" in i.lower() for i in issues)


class TestAiVocabScore:

    def test_high_ai_vocab(self):
        text = "delve into the nuanced tapestry of multifaceted paradigms, furthermore holistic"
        score, words = _ai_vocab_score(text)
        assert score > 0.3
        assert len(words) > 0

    def test_low_ai_vocab(self):
        text = "The dog ran across the field. It was a sunny afternoon."
        score, words = _ai_vocab_score(text)
        assert score == 0.0
        assert len(words) == 0

    def test_empty_text(self):
        score, words = _ai_vocab_score("")
        assert score == 0.0
        assert words == []


class TestExtractMetadata:

    def test_extracts_producer(self):
        data = b"%PDF-1.4\n/Producer (Adobe Acrobat 11.0)\n%%EOF"
        meta = _extract_metadata(data)
        assert "Producer" in meta
        assert "Adobe" in meta["Producer"]

    def test_no_metadata(self):
        meta = _extract_metadata(b"%PDF-1.4\n%%EOF")
        assert meta == {}


class TestAnalyzePdf:

    def test_minimal_pdf_low_risk(self):
        result = analyze_pdf(MINIMAL_PDF)
        assert "risk_level" in result
        assert "fake_probability" in result
        assert "findings" in result
        assert isinstance(result["findings"], list)
        assert result["risk_level"] == "LOW"

    def test_ai_vocab_pdf_higher_score(self):
        result = analyze_pdf(AI_VOCAB_PDF)
        assert result["ai_vocab_score"] > 0.0
        assert len(result["matched_ai_words"]) > 0

    def test_result_schema(self):
        result = analyze_pdf(MINIMAL_PDF)
        required_keys = {
            "risk_level", "fake_probability", "is_ai_generated",
            "findings", "metadata", "structure_ok", "ai_vocab_score",
            "matched_ai_words", "file_size_bytes",
        }
        assert required_keys.issubset(result.keys())

    def test_probability_in_range(self):
        result = analyze_pdf(MINIMAL_PDF)
        assert 0.0 <= result["fake_probability"] <= 1.0

    def test_empty_bytes(self):
        result = analyze_pdf(b"")
        assert result["risk_level"] in ("LOW", "MEDIUM", "HIGH")
        assert not result["structure_ok"]
