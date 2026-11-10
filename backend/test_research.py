import json
import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

import pymupdf
from docx import Document
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
rag_stub = ModuleType("rag")
rag_stub.retrieve_documents = lambda *_args, **_kwargs: []
rag_stub.get_collection = lambda: None
rag_stub.get_model = lambda: None
sys.modules["rag"] = rag_stub

import main


def create_groq_client(content):
    return SimpleNamespace(
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

        retrieve.assert_called_with("Spaced practice", top_k=20)
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
