"""
legal_chat – Entity X Legal Assistance Module.

Provides jurisdiction-aware LEGAL AWARENESS (not legal advice) for
scenarios involving AI-generated content, image misuse, deepfakes,
defamation, and identity abuse.

Design constraints:
- Does NOT give legal advice.
- Does NOT accuse anyone.
- Does NOT assert that any content is illegal.
- Does NOT use directive phrases such as "file under" or "this is illegal".
- Uses awareness language only: "may", "commonly", "often referenced".
- Calm, structured, section-wise output.
- Mandatory disclaimer appended to every response:
  "This information is for general awareness only and not legal advice."

Primary jurisdiction : India (BNS 2023, IT Act 2000)
Secondary            : General international cyber-law principles

Architecture
------------
Inputs  → LegalChatRequest
            entity_type       "IMAGE" | "NEWS" | "TEXT"
            context           Free-text scenario tag or description
            country           ISO country name / code (defaults to India)
            analysis_data     Optional dict of detection pipeline outputs

Processing → LegalChatEngine
            1. Detect scenario from entity_type + context
            2. Select jurisdiction layer (India / Global / Both)
            3. Build structured output sections

Outputs → LegalChatResponse
            rights_explanation    Plain-language explanation of relevant rights
            relevant_sections     Commonly referenced laws / acts per scenario
            steps_to_proceed      Numbered action checklist
            evidence_needed       Evidence preservation checklist
            reporting_paths       Platform / cyber-cell / court pathways
            disclaimer            Mandatory notice (non-legal-advice)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


# ---------------------------------------------------------------------------
# Disclaimer
# Legal-chat-specific: awareness-focused, no legal-advice framing.
# ---------------------------------------------------------------------------

_CHAT_DISCLAIMER = (
    "This information is for general awareness only and not legal advice. "
    "Entity X is an informational tool. All analysis results are "
    "probabilistic estimates produced by automated systems and may contain "
    "errors. Always seek guidance from a qualified legal professional before "
    "taking any formal action."
)


# ---------------------------------------------------------------------------
# Scenario taxonomy
# ---------------------------------------------------------------------------

_SCENARIO_IMAGE_MISUSE   = "IMAGE_MISUSE"
_SCENARIO_DEEPFAKE       = "DEEPFAKE"
_SCENARIO_DEFAMATION     = "DEFAMATION"
_SCENARIO_FAKE_NEWS      = "FAKE_NEWS"
_SCENARIO_IMPERSONATION  = "IMPERSONATION"
_SCENARIO_GENERIC        = "GENERIC"

# Keywords that suggest each scenario (checked case-insensitively)
_CONTEXT_KEYWORDS: dict[str, list[str]] = {
    _SCENARIO_IMAGE_MISUSE: [
        "image misuse", "image without consent", "photo misuse",
        "picture used", "portrait", "photograph",
    ],
    _SCENARIO_DEEPFAKE: [
        "deepfake", "morphed", "morphing", "ai-generated image",
        "synthetic image", "face swap", "manipulated image",
    ],
    _SCENARIO_DEFAMATION: [
        "defamation", "defamatory", "reputation", "libel", "slander",
        "false statement", "character assassination",
    ],
    _SCENARIO_FAKE_NEWS: [
        "fake news", "misinformation", "disinformation", "false news",
        "misleading news", "false article", "fabricated",
    ],
    _SCENARIO_IMPERSONATION: [
        "impersonation", "identity misuse", "identity theft",
        "fake account", "fake profile", "pretending to be",
    ],
}

# Mapping IMAGE entity_type to default scenario when context is vague
_ENTITY_TYPE_DEFAULTS: dict[str, str] = {
    "IMAGE": _SCENARIO_IMAGE_MISUSE,
    "NEWS":  _SCENARIO_FAKE_NEWS,
    "TEXT":  _SCENARIO_DEFAMATION,
}


# ---------------------------------------------------------------------------
# Knowledge base
# ---------------------------------------------------------------------------

@dataclass
class _JurisdictionBlocks:
    """Holds jurisdiction-specific legal reference text per scenario."""
    india: list[str]
    global_: list[str]


_SECTIONS: dict[str, _JurisdictionBlocks] = {
    _SCENARIO_IMAGE_MISUSE: _JurisdictionBlocks(
        india=[
            "Section 66E, Information Technology Act, 2000 — commonly "
            "referenced in matters involving the capture or transmission "
            "of private images without consent.",
            "Section 67, Information Technology Act, 2000 — often referenced "
            "when electronic publication of obscene material may be involved.",
            "Section 77, Bharatiya Nyaya Sanhita (BNS), 2023 — commonly "
            "referenced in cases that may involve voyeurism or the "
            "non-consensual capture of images.",
            "Section 356, Bharatiya Nyaya Sanhita (BNS), 2023 — the "
            "defamation provision that may be referenced when an image "
            "is used in a manner that could harm reputation.",
        ],
        global_=[
            "General Data Protection Regulation (GDPR), Article 6 — "
            "commonly referenced for the lawful basis of image processing "
            "in EU/UK-applicable scenarios.",
            "Right of Publicity principles — recognised in several "
            "jurisdictions as protecting an individual's likeness from "
            "unauthorised commercial or harmful use.",
            "Platform Non-Consensual Intimate Imagery (NCII) policies — "
            "most major platforms maintain dedicated reporting pathways "
            "for this category of content.",
        ],
    ),
    _SCENARIO_DEEPFAKE: _JurisdictionBlocks(
        india=[
            "Section 66E, Information Technology Act, 2000 — commonly "
            "referenced in synthetic-image scenarios involving privacy "
            "violations through electronic means.",
            "Section 66D, Information Technology Act, 2000 — often "
            "referenced when AI-generated content may involve cheating "
            "by personation using a computer resource.",
            "Section 67A, Information Technology Act, 2000 — may be "
            "referenced in deepfake matters of a sexually explicit nature.",
            "Section 337, Bharatiya Nyaya Sanhita (BNS), 2023 — commonly "
            "referenced when a forgery-related element harming reputation "
            "may be present.",
            "IT (Intermediary Guidelines & Digital Media Ethics Code) "
            "Rules, 2021 — platforms are commonly expected to act on "
            "takedown requests within defined timelines.",
        ],
        global_=[
            "Online Safety Act (UK) — includes provisions commonly "
            "referenced for non-consensual intimate deepfake imagery.",
            "EU AI Act — a regulatory framework often cited for high-risk "
            "AI systems that produce synthetic media.",
            "Platform NCII policies — most major platforms have adopted "
            "policies specifically addressing non-consensual deepfake "
            "or synthetic intimate content.",
        ],
    ),
    _SCENARIO_DEFAMATION: _JurisdictionBlocks(
        india=[
            "Section 356, Bharatiya Nyaya Sanhita (BNS), 2023 — the "
            "primary defamation provision commonly referenced for "
            "online reputational harm; covers both civil and criminal "
            "aspects.",
            "Section 66E, Information Technology Act, 2000 — may be "
            "referenced when privacy violation accompanies defamatory "
            "electronic publication.",
            "Press Council of India Norms — commonly applicable when "
            "defamatory content appears in a news or media publication.",
        ],
        global_=[
            "Defamation Act 2013 (UK) — sets a 'serious harm' threshold "
            "commonly cited in defamation discussions internationally.",
            "Section 230, Communications Decency Act (US) — often "
            "referenced for understanding platform liability limits "
            "and available takedown avenues.",
            "GDPR Right to Erasure — may be referenced in support of "
            "removal requests for defamatory content in EU-linked "
            "scenarios.",
        ],
    ),
    _SCENARIO_FAKE_NEWS: _JurisdictionBlocks(
        india=[
            "Section 197, Bharatiya Nyaya Sanhita (BNS), 2023 — commonly "
            "referenced in matters involving statements that may conduce "
            "to public mischief or disharmony.",
            "IT (Intermediary Guidelines) Rules, 2021 — platforms are "
            "commonly expected to act on grievances about false or "
            "misleading information within defined timelines.",
            "Disaster Management Act, 2005 — may be referenced "
            "specifically for misinformation spread during a declared "
            "emergency or disaster.",
            "Press Council of India Norms — commonly applicable to "
            "online news portals and digital journalism outlets.",
        ],
        global_=[
            "EU Digital Services Act (DSA) — commonly referenced for "
            "platform obligations to address systemic disinformation "
            "risks.",
            "Platform misinformation policies — labelling, limiting, and "
            "removal policies exist on major social media and news "
            "aggregation services.",
        ],
    ),
    _SCENARIO_IMPERSONATION: _JurisdictionBlocks(
        india=[
            "Section 66C, Information Technology Act, 2000 — commonly "
            "referenced in matters that may involve identity theft "
            "using electronic means.",
            "Section 66D, Information Technology Act, 2000 — often "
            "referenced when cheating by personation using a computer "
            "resource or communication device may be involved.",
            "Section 319, Bharatiya Nyaya Sanhita (BNS), 2023 — commonly "
            "referenced in cases that may involve cheating by personation.",
            "Section 336, Bharatiya Nyaya Sanhita (BNS), 2023 — may be "
            "referenced when a forgery element associated with cheating "
            "is present.",
        ],
        global_=[
            "Platform impersonation policies — all major platforms "
            "maintain dedicated impersonation reporting channels and "
            "commonly treat such reports as a priority category.",
            "GDPR Article 17 (Right to Erasure) — may be referenced in "
            "support of removal of fraudulent accounts misusing personal "
            "data in EU-linked scenarios.",
        ],
    ),
    _SCENARIO_GENERIC: _JurisdictionBlocks(
        india=[
            "Information Technology Act, 2000 — the primary legislation "
            "commonly governing cyberspace matters in India.",
            "Bharatiya Nyaya Sanhita (BNS), 2023 — the current criminal "
            "code with provisions commonly referenced for digital harm, "
            "identity misuse, and online speech.",
            "IT (Intermediary Guidelines & Digital Media Ethics Code) "
            "Rules, 2021 — commonly govern platform responsibilities "
            "and takedown procedures.",
        ],
        global_=[
            "Budapest Convention on Cybercrime — the primary international "
            "treaty commonly referenced in cyber-offence discussions.",
            "Universal Declaration of Human Rights, Article 12 — the "
            "right to privacy, referenced across jurisdictions.",
        ],
    ),
}

_RIGHTS: dict[str, str] = {
    _SCENARIO_IMAGE_MISUSE: (
        "Individuals are generally considered to have a recognised interest "
        "in controlling how their likeness and personal images are used. "
        "Publishing another person's image without consent — particularly in "
        "a misleading or harmful context — may fall under privacy, data "
        "protection, or identity-related provisions in many jurisdictions. "
        "Platform reporting mechanisms commonly exist for requesting the "
        "removal of such content, and cyber-reporting portals may offer "
        "additional pathways."
    ),
    _SCENARIO_DEEPFAKE: (
        "The right to personal dignity and control over one's digital "
        "representation is increasingly acknowledged across legal systems. "
        "AI-generated or algorithmically altered depictions of individuals "
        "may be associated with provisions related to privacy, identity "
        "misuse, and reputational harm — particularly when produced without "
        "consent and distributed publicly. Platform-level reporting and "
        "cyber-portal channels may be available avenues for awareness and "
        "content removal."
    ),
    _SCENARIO_DEFAMATION: (
        "Individuals may have a recognised interest in protecting their "
        "reputation from false and damaging statements. When content "
        "published online is alleged to be untrue and to cause reputational "
        "harm, relevant frameworks may treat this as a potential defamation "
        "matter — subject to common defences such as truth, fair comment, "
        "and privilege. Applicable standards may vary significantly by "
        "jurisdiction, and professional legal guidance is advisable before "
        "taking any formal step."
    ),
    _SCENARIO_FAKE_NEWS: (
        "When false or misleading content is alleged to cause direct harm — "
        "such as reputational damage, public concern, or economic injury — "
        "affected parties may have awareness pathways through platform "
        "grievance mechanisms, press regulatory bodies, and cyber portals. "
        "The ability to seek correction and retraction is widely acknowledged "
        "across jurisdictions."
    ),
    _SCENARIO_IMPERSONATION: (
        "Creating a false digital identity using another person's name, "
        "image, or credentials may be associated with identity-protection "
        "provisions in many jurisdictions. Affected individuals may consider "
        "reporting such accounts to platforms, as most treat this as a "
        "priority category. Cyber-reporting portals may also offer "
        "additional awareness pathways depending on the nature of harm."
    ),
    _SCENARIO_GENERIC: (
        "Individuals may have rights related to privacy, dignity, and "
        "protection from online harm. The specific provisions that may be "
        "relevant depend on the nature of the content, the jurisdiction, "
        "and the platforms involved. Preserving evidence and documenting "
        "the situation is commonly considered an important first step "
        "regardless of which pathway is later explored."
    ),
}

_STEPS: dict[str, list[str]] = {
    _SCENARIO_IMAGE_MISUSE: [
        "Preserve evidence — capture full-page screenshots including the "
        "URL bar, and record the date and time of discovery.",
        "Note the platform or website where the content appears and "
        "locate its official content-reporting or abuse mechanism.",
        "The platform's 'non-consensual image' or 'privacy violation' "
        "reporting category may be a relevant pathway.",
        "Cyber-crime awareness portals such as cybercrime.gov.in (India) "
        "commonly accept reports of image misuse and may offer guidance.",
        "Seeking awareness from a qualified legal professional before "
        "taking any formal step is commonly advisable.",
    ],
    _SCENARIO_DEEPFAKE: [
        "Preserve evidence immediately — screenshot the content with the "
        "URL bar visible and note the platform name and timestamp.",
        "Save any Entity X forensic report generated for this content, "
        "as it may be useful for reference purposes.",
        "The platform's dedicated deepfake or NCII (non-consensual "
        "intimate imagery) reporting pathway, where available, may be "
        "a relevant first step.",
        "If no specific deepfake category exists on the platform, general "
        "'privacy violation' or 'fake media' pathways are commonly available.",
        "Cyber-reporting portals such as cybercrime.gov.in (India) may "
        "accept awareness reports related to synthetic or manipulated "
        "imagery.",
        "Seeking awareness from a qualified legal professional experienced "
        "in cyber and privacy matters is commonly advisable before "
        "escalating further.",
    ],
    _SCENARIO_DEFAMATION: [
        "Document the content — screenshot with visible URL, timestamp, "
        "and author or source details where available.",
        "Consider creating an archive copy (e.g. via archive.org) in "
        "case the content is later edited or removed.",
        "The platform's 'false information' or 'harassment' reporting "
        "channels may be a relevant pathway for a takedown request.",
        "If the content appears in a news or media outlet, the "
        "Press Council of India (or equivalent body) may have a "
        "relevant grievance mechanism.",
        "Seeking awareness from a qualified legal professional about "
        "possible civil or formal pathways is commonly advisable.",
    ],
    _SCENARIO_FAKE_NEWS: [
        "Preserve the article or post — save a screenshot and the URL "
        "before the content may be edited or removed.",
        "Checking whether the claim has been reviewed by a recognised "
        "fact-checking organisation (e.g. AltNews, Boom, FactChecker.in) "
        "may help contextualise the content.",
        "The platform's 'false information' or 'misinformation' "
        "reporting pathway may be a relevant step.",
        "The Ministry of Information and Broadcasting (India) maintains "
        "a grievance portal commonly used for concerns about regulated "
        "digital news publishers.",
        "Seeking awareness from a qualified legal professional about "
        "options for correction, retraction, or formal pathways is "
        "commonly advisable.",
    ],
    _SCENARIO_IMPERSONATION: [
        "Document the account or content — screenshot profile details, "
        "posts, and the platform URL.",
        "The platform's 'fake account' or 'impersonation' reporting "
        "flow is commonly a priority pathway on most major platforms.",
        "Reviewing and updating passwords on authentic accounts is a "
        "commonly suggested precautionary step.",
        "Cyber-reporting portals such as cybercrime.gov.in (India) may "
        "accept awareness reports related to identity misuse.",
        "If financial transactions may have been affected, contacting "
        "the relevant institution promptly is commonly advisable.",
        "Seeking awareness from a qualified legal professional about "
        "provisions that may be relevant to the situation is advisable "
        "before taking any formal step.",
    ],
    _SCENARIO_GENERIC: [
        "Document the content — capture screenshots, URLs, and timestamps.",
        "Identify and locate the reporting or abuse mechanism on the "
        "platform where the content appears.",
        "Cyber-crime awareness portals may offer jurisdiction-specific "
        "guidance on available pathways.",
        "Seeking awareness from a qualified legal professional before "
        "taking any formal step is commonly advisable.",
    ],
}

_EVIDENCE: dict[str, list[str]] = {
    _SCENARIO_IMAGE_MISUSE: [
        "Full-page screenshot of the content including the URL bar.",
        "Direct URL or permalink to the offending content.",
        "Date and time of discovery (and if known, of publication).",
        "Proof of your own original image ownership (e.g. original file "
        "with EXIF metadata, earlier social-media post, or camera roll).",
        "Entity X forensic report (if generated).",
        "Record of any prior communication with the publisher or platform.",
    ],
    _SCENARIO_DEEPFAKE: [
        "Full-page screenshot of the content with URL bar visible.",
        "Direct URL or permalink to the deepfake content.",
        "Entity X forensic analysis report showing deepfake probability.",
        "Original unaltered images or videos that establish your authentic "
        "appearance for comparison.",
        "Timestamps of discovery and any evidence of distribution or sharing.",
        "Any messages, DMs, or notifications you received about the content.",
    ],
    _SCENARIO_DEFAMATION: [
        "Screenshot of the defamatory statement, including author name, "
        "platform, and date/time.",
        "Direct URL to the content.",
        "Archive copy (archive.org or similar) in case the content is removed.",
        "Documentation of the factual inaccuracy (evidence that the "
        "statement is false).",
        "Evidence of harm: professional impact, social media responses, "
        "or testimonials, where applicable.",
        "Any prior communications with the author or platform.",
    ],
    _SCENARIO_FAKE_NEWS: [
        "Screenshot of the article/post with the URL bar visible.",
        "Direct URL or DOI of the publication.",
        "Fact-check reports from credible organisations (if available).",
        "Entity X text-analysis report showing misinformation risk score.",
        "Evidence of harm caused by the false information.",
        "Any correction or retraction history associated with the publisher.",
    ],
    _SCENARIO_IMPERSONATION: [
        "Screenshots of the impersonating account/profile with URL.",
        "Screenshots of posts or messages sent from the impersonating "
        "account that caused or could cause harm.",
        "Proof of your authentic identity on the same or other platforms.",
        "Evidence of harm: financial transactions, communications "
        "misdirected to the fake account, etc.",
        "Any communications you received from people who were deceived "
        "by the impersonating account.",
    ],
    _SCENARIO_GENERIC: [
        "Full-page screenshots of the relevant content with URL bar visible.",
        "Permalink or direct URL to the content.",
        "Date and time of discovery.",
        "Any Entity X analysis reports generated for the content.",
        "A written record of how the content has affected you.",
    ],
}

_REPORTING: dict[str, list[str]] = {
    _SCENARIO_IMAGE_MISUSE: [
        "Platform pathway — the platform's 'Report' or content-menu "
        "option under 'Privacy' or 'Non-consensual intimate image' is "
        "commonly a first available step.",
        "India — National Cyber Crime Reporting Portal "
        "(cybercrime.gov.in) — commonly accepts awareness submissions "
        "under 'Women/Child Related Crimes' or 'Other Cyber Crimes'.",
        "India — approaching a local police station is an option that "
        "may be explored; seeking qualified legal awareness before "
        "doing so is commonly advisable given the procedural steps "
        "involved.",
        "India — legal pathway — a qualified legal professional may "
        "advise on civil options such as seeking interim relief to "
        "support content removal.",
    ],
    _SCENARIO_DEEPFAKE: [
        "Platform pathway — the dedicated deepfake or NCII reporting "
        "flow, where available, is commonly the most direct route; "
        "otherwise 'Privacy violation' or 'Fake media' categories "
        "may apply.",
        "StopNCII.org / Take It Down (NCMEC) — hash-matching services "
        "commonly used to help prevent re-upload of intimate imagery "
        "across participating platforms.",
        "India — National Cyber Crime Reporting Portal "
        "(cybercrime.gov.in) — commonly accepts submissions under "
        "'Women/Child Related Crimes' → 'Non-consensual intimate images'.",
        "India — National Commission for Women (NCW) — maintains an "
        "online cyber harassment awareness and reporting portal.",
        "India — legal pathway — a qualified legal professional may "
        "advise on options; Sections 66D and 66E of the IT Act and "
        "Section 337 of the BNS, 2023 are among the provisions "
        "commonly referenced in such matters.",
    ],
    _SCENARIO_DEFAMATION: [
        "Platform pathway — the 'Report' function under 'False "
        "information' or 'Harassment and bullying' may be a relevant "
        "first step.",
        "India — Press Council of India — may consider awareness "
        "submissions when defamatory content appears in a news or "
        "media outlet.",
        "India — legal pathway — Section 356 of the BNS, 2023 is "
        "commonly referenced in defamation matters; a qualified legal "
        "professional may advise on whether civil or other formal "
        "pathways may be appropriate.",
        "Global — GDPR Right to Erasure — may be referenced in support "
        "of a removal request in EU-linked scenarios.",
    ],
    _SCENARIO_FAKE_NEWS: [
        "Platform pathway — the 'Report post' option under 'False "
        "information' or 'Misinformation' is commonly available on "
        "major platforms.",
        "India — Ministry of Information and Broadcasting (MIB) — "
        "maintains a grievance portal commonly used for regulated "
        "digital news publishers.",
        "India — National Cyber Crime Reporting Portal "
        "(cybercrime.gov.in) — may be relevant for misinformation "
        "content alleged to cause communal disharmony or public harm.",
        "Fact-checking pathways — submitting content to recognised "
        "fact-checking organisations such as AltNews, Boom, or "
        "FactChecker.in (India) may help establish a public record "
        "of inaccuracy.",
        "India — legal pathway — Section 197 of the BNS, 2023 and "
        "IT Rules, 2021 are commonly referenced; a qualified legal "
        "professional may advise on further options.",
    ],
    _SCENARIO_IMPERSONATION: [
        "Platform pathway — the 'Report' option under 'Fake account' "
        "or 'Impersonation' is commonly treated as a priority category "
        "by most major platforms.",
        "India — National Cyber Crime Reporting Portal "
        "(cybercrime.gov.in) — commonly accepts awareness submissions "
        "under 'Other Cyber Crimes'; providing account URL and "
        "screenshots is commonly recommended.",
        "India — CERT-In (cert-in.org.in) — may be relevant for "
        "awareness reporting of cyber incidents involving identity "
        "misuse.",
        "India — legal pathway — Sections 66C and 66D of the IT Act "
        "and Sections 319 and 336 of the BNS, 2023 are among the "
        "provisions commonly referenced in impersonation matters; a "
        "qualified legal professional may advise on appropriate steps.",
    ],
    _SCENARIO_GENERIC: [
        "Platform pathway — the content's built-in 'Report' or 'Flag' "
        "function is commonly a first available step.",
        "India — National Cyber Crime Reporting Portal "
        "(cybercrime.gov.in) — commonly accepts awareness submissions "
        "for a range of online concerns.",
        "Seeking awareness from a qualified legal professional before "
        "taking any formal step is commonly advisable.",
    ],
}


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class LegalChatRequest:
    """
    Input payload for the Legal Chat engine.

    Attributes
    ----------
    entity_type     Content category: "IMAGE" | "NEWS" | "TEXT"
    context         Free-text scenario description (e.g. "image misuse",
                    "deepfake", "defamation").  Used for scenario detection.
    country         Jurisdiction preference.  Accepted values:
                    "India" (default), "Global", "Both".
    analysis_data   Optional dict of detection pipeline outputs from
                    image-monitor or text-monitor endpoints.  Keys used
                    when present:
                        fake_probability, misinformation_risk,
                        credibility_score, ai_generated_probability,
                        forensic_explanation.
    """
    entity_type:   Literal["IMAGE", "NEWS", "TEXT"] = "TEXT"
    context:       str = ""
    country:       str = "India"
    analysis_data: dict = field(default_factory=dict)


@dataclass
class LegalChatResponse:
    """
    Structured output produced by the Legal Chat engine.

    Attributes
    ----------
    scenario            Detected scenario tag (internal reference).
    rights_explanation  Plain-language summary of potentially relevant rights.
    relevant_sections   List of commonly referenced laws / acts.
    steps_to_proceed    Ordered action checklist for the user.
    evidence_needed     Evidence preservation checklist.
    reporting_paths     Platform / cyber-cell / court pathway descriptions.
    analysis_context    Optional contextual notes derived from analysis_data.
    disclaimer          Mandatory non-legal-advice notice.
    """
    scenario:           str
    rights_explanation: str
    relevant_sections:  list[str]
    steps_to_proceed:   list[str]
    evidence_needed:    list[str]
    reporting_paths:    list[str]
    analysis_context:   list[str]
    disclaimer:         str


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class LegalChatEngine:
    """
    Rule-based legal chat engine.

    Detects the scenario from entity_type and context keywords, selects the
    appropriate jurisdiction layer, and assembles a fully structured
    LegalChatResponse.  No external API calls are made.
    """

    def build_response(self, request: LegalChatRequest) -> LegalChatResponse:
        """
        Process a LegalChatRequest and return a LegalChatResponse.

        Args:
            request: Populated LegalChatRequest instance.

        Returns:
            LegalChatResponse with all sections populated.
        """
        scenario = self._detect_scenario(request.entity_type, request.context)
        sections = self._select_sections(scenario, self._normalise_country(request.country))
        context_notes = self._build_context_notes(request.analysis_data)

        return LegalChatResponse(
            scenario=scenario,
            rights_explanation=_RIGHTS[scenario],
            relevant_sections=sections,
            steps_to_proceed=_STEPS[scenario],
            evidence_needed=_EVIDENCE[scenario],
            reporting_paths=_REPORTING[scenario],
            analysis_context=context_notes,
            disclaimer=_CHAT_DISCLAIMER,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_scenario(entity_type: str, context: str) -> str:
        """
        Infer the most likely scenario from entity_type and context text.

        Priority: keyword match in context → entity_type default → GENERIC.
        """
        ctx_lower = context.lower()
        for scenario, keywords in _CONTEXT_KEYWORDS.items():
            if any(kw in ctx_lower for kw in keywords):
                return scenario
        return _ENTITY_TYPE_DEFAULTS.get(entity_type.upper(), _SCENARIO_GENERIC)

    @staticmethod
    def _normalise_country(country: str) -> str:
        """
        Normalise the country string to one of "india", "global", "both".

        Defaults to "both" (India + global) for unrecognised values.
        """
        c = country.strip().lower()
        if c in ("india", "in"):
            return "india"
        if c in ("global", "international", "worldwide"):
            return "global"
        # "both", empty string, or unrecognised → both
        return "both"

    @staticmethod
    def _select_sections(scenario: str, country: str) -> list[str]:
        """
        Return the list of relevant law sections for the detected scenario
        and jurisdiction.
        """
        blocks = _SECTIONS.get(scenario, _SECTIONS[_SCENARIO_GENERIC])
        if country == "india":
            return blocks.india
        if country == "global":
            return blocks.global_
        # "both" — India first, then global, no deduplication needed
        return blocks.india + blocks.global_

    @staticmethod
    def _build_context_notes(analysis_data: dict) -> list[str]:
        """
        Translate raw analysis_data values into human-readable contextual
        notes that can contextualise the guidance without giving legal advice.

        Only keys present in analysis_data and with non-None values are
        included.
        """
        notes: list[str] = []

        fp = analysis_data.get("fake_probability")
        if fp is not None:
            pct = round(float(fp) * 100, 1)
            level = "elevated" if pct >= 70 else "moderate" if pct >= 40 else "low"
            notes.append(
                f"Automated analysis indicates a {level} probability "
                f"({pct}%) that this image may have been synthetically "
                "generated or manipulated. This is an informational estimate "
                "only and is not conclusive."
            )

        agp = analysis_data.get("ai_generated_probability")
        if agp is not None:
            pct = round(float(agp) * 100, 1)
            notes.append(
                f"AI-generation probability for this content is estimated at "
                f"{pct}%. Automated detection results should be verified by "
                "a qualified expert before use in any formal proceeding."
            )

        risk = analysis_data.get("misinformation_risk")
        if risk:
            risk_upper = str(risk).upper()
            label = {
                "HIGH":   "high",
                "MEDIUM": "moderate",
                "LOW":    "low",
            }.get(risk_upper, "undetermined")
            notes.append(
                f"The misinformation-risk score for this content has been "
                f"assessed as {label} by the automated system. This is an "
                "indicative score and does not constitute a determination "
                "of intentional falsification."
            )

        cred = analysis_data.get("credibility_score")
        if cred is not None:
            pct = round(float(cred) * 100, 1)
            notes.append(
                f"The automated credibility indicator for this content is "
                f"{pct}%. Lower credibility scores may suggest further "
                "review is warranted, but do not imply the content is "
                "definitively false."
            )

        forensic = analysis_data.get("forensic_explanation")
        if forensic and isinstance(forensic, list):
            notes.append(
                "Forensic analysis findings for this item are available in "
                "the Entity X analysis report and may be referenced when "
                "preserving evidence."
            )

        return notes


# ---------------------------------------------------------------------------
# Module-level singleton + convenience function
# ---------------------------------------------------------------------------

_engine: LegalChatEngine | None = None


def get_engine() -> LegalChatEngine:
    """Return the shared LegalChatEngine singleton."""
    global _engine            # noqa: PLW0603
    if _engine is None:
        _engine = LegalChatEngine()
    return _engine


def run_legal_chat(
    entity_type: Literal["IMAGE", "NEWS", "TEXT"] = "TEXT",
    context: str = "",
    country: str = "India",
    analysis_data: dict | None = None,
) -> LegalChatResponse:
    """
    Convenience wrapper — build and run a legal chat query.

    Args:
        entity_type     "IMAGE" | "NEWS" | "TEXT"
        context         Scenario description string.
        country         Jurisdiction string ("India", "Global", "Both").
        analysis_data   Optional dict of detection pipeline outputs.

    Returns:
        LegalChatResponse with all guidance sections populated.

    Example
    -------
    >>> from legal.legal_chat import run_legal_chat
    >>> resp = run_legal_chat(entity_type="IMAGE", context="deepfake")
    >>> print(resp.rights_explanation)
    """
    request = LegalChatRequest(
        entity_type=entity_type,
        context=context,
        country=country,
        analysis_data=analysis_data or {},
    )
    return get_engine().build_response(request)
