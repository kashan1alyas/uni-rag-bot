import json
import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pymupdf
from docx import Document
from fastapi.testclient import TestClient
from groq import BadRequestError, RateLimitError

sys.path.insert(0, str(Path(__file__).parent))
rag_stub = ModuleType("rag")
rag_stub.retrieve_documents = lambda *_args, **_kwargs: []
rag_stub.get_collection = lambda: None
rag_stub.get_model = lambda: None
sys.modules["rag"] = rag_stub

import main


def create_groq_client(content):
    groq_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=Mock(
                    return_value=SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                message=SimpleNamespace(content=content)
                            )
                        ]
                    )
                )
            )
        )
    )
    groq_client.with_options = Mock(return_value=groq_client)
    return groq_client


def create_rate_limit_error(retry_after):
    body = {"error": {"message": "Token per minute limit exceeded."}}
    response = httpx.Response(
        429,
        request=httpx.Request(
            "POST",
            "https://api.groq.com/openai/v1/chat/completions",
        ),
        headers={"retry-after": retry_after, "x-request-id": "req_rate_limit_test"},
    )
    return RateLimitError(
        "Error code: 429 - Token per minute limit exceeded.",
        response=response,
        body=body,
    )


class ResearchAssistantTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.documents = [
            "Study of Spaced Retrieval\nJordan Lee\nJournal of Learning Research\n2022",
            "The paper reports spaced practice improved delayed recall.",
            "Participants completed weekly retrieval sessions.",
            "The authors conclude that repeated retrieval supports retention.",
            "Control groups followed the standard lecture schedule.",
        ]
        self.metadatas = [
            {"source": "learning-study.pdf", "page": 1, "chunk": 0},
            {"source": "learning-study.pdf", "page": 2, "chunk": 0},
            {"source": "learning-study.pdf", "page": 3, "chunk": 1},
            {"source": "learning-study.pdf", "page": 7, "chunk": 2},
            {"source": "control-study.pdf", "page": 1, "chunk": 0},
        ]
        self.collection = SimpleNamespace(
            count=lambda: len(self.documents),
            get=lambda **_kwargs: {
                "documents": self.documents,
                "metadatas": self.metadatas,
            },
        )
        self.draft = {
            "outline": [
                self.claim("Review the study question.", "learning-study.pdf", "2"),
                self.claim("Compare learning approaches.", "learning-study.pdf", "3"),
                self.claim("Summarize reported outcomes.", "learning-study.pdf", "7"),
            ],
            "objectives": [
                self.claim("Describe the practice schedule.", "learning-study.pdf", "3"),
                self.claim("Summarize delayed recall findings.", "learning-study.pdf", "2"),
            ],
            "problem_statement": self.claim(
                "The excerpt reports on delayed recall after spaced practice.",
                "learning-study.pdf",
                "2",
            ),
            "literature_summaries": [
                self.claim(
                    "The paper reports improved delayed recall.",
                    "learning-study.pdf",
                    "2",
                ),
                self.claim(
                    "The study used weekly retrieval sessions.",
                    "learning-study.pdf",
                    "3",
                ),
            ],
            "research_questions": [
                self.claim(
                    "How is spaced practice related to delayed recall?",
                    "learning-study.pdf",
                    "2",
                ),
                self.claim(
                    "How were retrieval sessions scheduled?",
                    "learning-study.pdf",
                    "3",
                ),
            ],
            "paper_analyses": [
                {
                    "source": "learning-study.pdf",
                    "key_findings": [
                        self.claim(
                            "Spaced practice improved delayed recall.",
                            "learning-study.pdf",
                            "2",
                        )
                    ],
                    "methodology": [
                        self.claim(
                            "Participants completed weekly retrieval sessions.",
                            "learning-study.pdf",
                            "3",
                        )
                    ],
                    "conclusions": [
                        self.claim(
                            "Repeated retrieval supports retention.",
                            "learning-study.pdf",
                            "7",
                        )
                    ],
                }
            ],
            "references": [
                {
                    "source": "learning-study.pdf",
                    "page": "1",
                    "authors": ["Jordan Lee"],
                    "year": "2022",
                    "title": "Study of Spaced Retrieval",
                    "publication": "Journal of Learning Research",
                    "doi": "",
                }
            ],
        }

    @staticmethod
    def claim(text, source, page):
        return {
            "text": text,
            "citations": [{"source": source, "page": page}],
        }

    def test_lists_sources_and_generates_source_grounded_research_content(self):
        groq_client = create_groq_client(json.dumps(self.draft))
        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
        ):
            sources = self.client.get("/api/research/sources")
            response = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Spaced practice and student retention",
                    "citation_style": "APA",
                    "selected_sources": ["learning-study.pdf"],
                },
            )

        self.assertEqual(sources.status_code, 200)
        self.assertEqual(
            sources.json()["sources"],
            ["control-study.pdf", "learning-study.pdf"],
        )
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["sources"], ["learning-study.pdf"])
        self.assertIn("Research outline", result["content"])
        self.assertIn("Research objectives", result["content"])
        self.assertIn("Problem statement", result["content"])
        self.assertIn("Literature summaries", result["content"])
        self.assertIn("Research questions", result["content"])
        self.assertIn("Key findings", result["content"])
        self.assertIn("Methodology", result["content"])
        self.assertIn("Conclusions", result["content"])
        self.assertIn("(Lee, 2022, p. 2)", result["content"])
        self.assertIn(
            "Lee, J. (2022). Study of Spaced Retrieval. "
            "*Journal of Learning Research*.",
            result["content"],
        )
        self.assertIn("not been independently verified", result["content"])
        prompt = groq_client.chat.completions.create.call_args.kwargs[
            "messages"
        ][1]["content"]
        self.assertIn("spaced practice improved delayed recall.", prompt)
        self.assertNotIn("Control groups followed", prompt)
        self.assertIn("REQUESTED CITATION STYLE: APA", prompt)

    def test_topic_only_uses_rag_and_mla_and_ieee_references_are_formatted(self):
        groq_client = create_groq_client(json.dumps(self.draft))
        retrieved = [
            {
                "text": self.documents[0],
                "source": "learning-study.pdf",
                "page": 1,
            },
            {
                "text": self.documents[1],
                "source": "learning-study.pdf",
                "page": 2,
            },
            {
                "text": self.documents[2],
                "source": "learning-study.pdf",
                "page": 3,
            },
            {
                "text": self.documents[3],
                "source": "learning-study.pdf",
                "page": 7,
            },
        ]
        with (
            patch.object(main, "retrieve_documents", return_value=retrieved) as retrieve,
            patch.object(main, "client", groq_client),
        ):
            mla = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Spaced practice",
                    "citation_style": "MLA",
                },
            )
            ieee = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Spaced practice",
                    "citation_style": "IEEE",
                },
            )

        retrieve.assert_called_with("Spaced practice", top_k=10)
        self.assertEqual(mla.status_code, 200)
        self.assertIn("(Lee 2)", mla.json()["content"])
        self.assertIn(
            '"Study of Spaced Retrieval." *Journal of Learning Research*, 2022.',
            mla.json()["content"],
        )
        self.assertEqual(ieee.status_code, 200)
        self.assertIn("[1, p. 2]", ieee.json()["content"])
        self.assertIn(
            '[1] J. Lee, "Study of Spaced Retrieval", '
            "Journal of Learning Research, 2022.",
            ieee.json()["content"],
        )

    def test_rejects_unknown_citations_missing_analyses_and_too_many_sources(self):
        invalid_draft = json.loads(json.dumps(self.draft))
        invalid_draft["outline"][0]["citations"][0]["source"] = "other.pdf"
        groq_client = create_groq_client(json.dumps(invalid_draft))
        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
        ):
            bad_citation = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Research question",
                    "selected_sources": ["learning-study.pdf"],
                },
            )
            invalid_metadata = json.loads(json.dumps(self.draft))
            invalid_metadata["references"][0]["year"] = "2021"
            groq_client.chat.completions.create.return_value = SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(invalid_metadata)
                        )
                    )
                ]
            )
            bad_reference = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Research question",
                    "selected_sources": ["learning-study.pdf"],
                },
            )
            groq_client.chat.completions.create.return_value = SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(self.draft)
                        )
                    )
                ]
            )
            missing_analysis = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Research question",
                    "selected_sources": [
                        "learning-study.pdf",
                        "control-study.pdf",
                    ],
                },
            )
            too_many = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Research question",
                    "selected_sources": [f"{index}.pdf" for index in range(13)],
                },
            )

        self.assertEqual(bad_citation.status_code, 502)
        self.assertEqual(bad_reference.status_code, 502)
        self.assertEqual(missing_analysis.status_code, 502)
        self.assertEqual(too_many.status_code, 422)

    def test_exports_pdf_and_editable_docx_with_content_and_verification_notice(self):
        export = {
            "title": "Spaced practice research",
            "content": (
                "# Research outline\n"
                "- Compare practice schedules (learning-study, n.d., p. 2)\n\n"
                "## References (APA)\n"
                "- learning-study.pdf. (n.d.). [Indexed PDF]."
            ),
            "sources": ["learning-study.pdf"],
        }
        pdf = self.client.post("/api/research/pdf", json=export)
        docx = self.client.post("/api/research/docx", json=export)

        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf.headers["content-type"], "application/pdf")
        pdf_document = pymupdf.open(stream=pdf.content, filetype="pdf")
        pdf_text = "\n".join(page.get_text() for page in pdf_document)
        self.assertIn("UNIASSIST | RESEARCH ASSISTANT", pdf_text)
        self.assertIn("learning-study.pdf", pdf_text)

        self.assertEqual(docx.status_code, 200)
        self.assertIn(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            docx.headers["content-type"],
        )
        word_document = Document(BytesIO(docx.content))
        paragraphs = "\n".join(item.text for item in word_document.paragraphs)
        self.assertIn("Spaced practice research", paragraphs)
        self.assertIn("AI-generated suggestions", paragraphs)
        self.assertIn("Compare practice schedules", paragraphs)
        self.assertIn("References (APA)", paragraphs)

    def test_reports_missing_model_and_missing_indexed_research_material(self):
        request = {"topic": "Research question"}
        with patch.object(main, "client", None):
            no_groq_key = self.client.post("/api/research/generate", json=request)
        self.assertEqual(no_groq_key.status_code, 500)
        self.assertIn("GROQ_API_KEY", no_groq_key.json()["detail"])

        empty_collection = SimpleNamespace(
            count=lambda: 0,
            get=lambda **_kwargs: {"documents": [], "metadatas": []},
        )
        with (
            patch.object(main, "get_collection", return_value=empty_collection),
            patch.object(main, "client", create_groq_client("{}")),
        ):
            no_sources = self.client.post(
                "/api/research/generate",
                json={**request, "all_documents": True},
            )
            no_retrieval = self.client.post(
                "/api/research/generate",
                json=request,
            )
        self.assertEqual(no_sources.status_code, 404)
        self.assertEqual(no_retrieval.status_code, 404)

    def test_groq_api_error_is_logged_and_returned_without_exposing_api_key(self):
        secret = "gsk_test_research_secret"
        provider_message = (
            f"Unsupported research response format; api_key={secret}"
        )
        body = {"error": {"message": provider_message}}
        api_response = httpx.Response(
            400,
            request=httpx.Request(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
            ),
            headers={"x-request-id": "req_research_test"},
        )
        groq_error = BadRequestError(
            f"Error code: 400 - {provider_message}",
            response=api_response,
            body=body,
        )
        groq_client = create_groq_client("")
        groq_client.chat.completions.create.side_effect = groq_error

        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
            patch.object(main, "api_key", secret),
            self.assertLogs(main.logger, level="ERROR") as captured,
        ):
            response = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Spaced practice and retention",
                    "selected_sources": ["learning-study.pdf"],
                },
            )

        self.assertEqual(response.status_code, 502)
        detail = response.json()["detail"]
        self.assertIn("Groq API error (HTTP 400)", detail)
        self.assertIn("Unsupported research response format", detail)
        self.assertIn("req_research_test", detail)
        self.assertNotIn(secret, detail)
        self.assertIn("status=400", captured.output[0])
        self.assertIn("req_research_test", captured.output[0])
        self.assertIn("Unsupported research response format", captured.output[0])
        self.assertNotIn(secret, captured.output[0])

    def test_research_context_limits_chunks_and_truncates_long_excerpts(self):
        records = [
            {
                "source": f"paper-{source_index}.pdf",
                "page": chunk_index + 1,
                "chunk": chunk_index,
                "text": f"Evidence from source {source_index}. " * 100,
            }
            for source_index in range(3)
            for chunk_index in range(12)
        ]

        context_records = main._limit_research_context_records(records)
        context = main._research_document_context(context_records)

        self.assertEqual(len(context_records), main.MAX_RESEARCH_CONTEXT_CHUNKS)
        self.assertEqual(
            {record["source"] for record in context_records},
            {f"paper-{index}.pdf" for index in range(3)},
        )
        self.assertLessEqual(len(context), main.MAX_RESEARCH_CONTEXT_CHARS)
        self.assertIn("[Excerpt truncated to fit the research context limit.]", context)
        for source_index in range(3):
            self.assertIn(f"Source: paper-{source_index}.pdf", context)
        self.assertIn("Page: 1", context)

    def test_research_retries_after_rate_limit_and_succeeds(self):
        groq_client = create_groq_client(json.dumps(self.draft))
        groq_client.chat.completions.create.side_effect = [
            create_rate_limit_error("2.5"),
            groq_client.chat.completions.create.return_value,
        ]
        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
            patch.object(main, "_sleep_for_research_retry") as sleep,
        ):
            response = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Spaced practice and retention",
                    "selected_sources": ["learning-study.pdf"],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(groq_client.with_options.call_args.kwargs, {"max_retries": 0})
        self.assertEqual(groq_client.chat.completions.create.call_count, 2)
        sleep.assert_called_once_with(2.5)

    def test_research_rate_limit_after_retry_returns_friendly_error(self):
        groq_client = create_groq_client("")
        groq_client.chat.completions.create.side_effect = [
            create_rate_limit_error("1"),
            create_rate_limit_error("1"),
        ]
        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
            patch.object(main, "_sleep_for_research_retry") as sleep,
        ):
            response = self.client.post(
                "/api/research/generate",
                json={
                    "topic": "Spaced practice and retention",
                    "selected_sources": ["learning-study.pdf"],
                },
            )

        self.assertEqual(response.status_code, 429)
        self.assertIn("still rate-limiting", response.json()["detail"])
        self.assertIn("wait a moment", response.json()["detail"])
        self.assertEqual(groq_client.chat.completions.create.call_count, 2)
        sleep.assert_called_once_with(1.0)

    def test_missing_bibliographic_metadata_uses_an_explicit_file_reference(self):
        reference = main.ResearchReferenceMetadata(
            source="paper.pdf",
            page="1",
        )
        self.assertEqual(
            main._research_reference(reference, "APA", 1),
            "[Indexed PDF: paper.pdf] (n.d.).",
        )


if __name__ == "__main__":
    unittest.main()
