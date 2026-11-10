import json
import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from pptx import Presentation

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


class PresentationApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.documents = [
            "Neural networks contain connected layers of units.",
            "Regression estimates relationships between variables.",
        ]
        self.metadatas = [
            {"source": "neural.pdf", "page": 2, "chunk": 0},
            {"source": "statistics.pdf", "page": 5, "chunk": 0},
        ]
        self.collection = SimpleNamespace(
            count=lambda: len(self.documents),
            get=lambda **_kwargs: {
                "documents": self.documents,
                "metadatas": self.metadatas,
            },
        )
        self.slides = [
            {
                "title": f"Neural networks - part {index}",
                "key_points": ["Networks use connected layers."],
                "explanation": "The selected excerpt describes the connected layers.",
                "example": "",
                "source": "neural.pdf",
                "page": "2",
            }
            for index in range(1, 4)
        ]
        self.request = {
            "topic": "Neural networks",
            "slide_count": 3,
            "language": "English",
            "style": "Academic",
            "selected_sources": ["neural.pdf"],
        }

    def test_lists_sources_and_generates_slides_from_only_selected_documents(self):
        groq_client = create_groq_client(json.dumps({"slides": self.slides}))
        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
        ):
            sources = self.client.get("/api/presentations/sources")
            response = self.client.post(
                "/api/presentations/generate",
                json=self.request,
            )

        self.assertEqual(sources.status_code, 200)
        self.assertEqual(
            sources.json()["sources"],
            ["neural.pdf", "statistics.pdf"],
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["slides"]), 3)
        self.assertEqual(response.json()["sources"], ["neural.pdf"])
        prompt = groq_client.chat.completions.create.call_args.kwargs[
            "messages"
        ][1]["content"]
        self.assertIn("Neural networks contain", prompt)
        self.assertNotIn("Regression estimates", prompt)
        self.assertIn("LANGUAGE: English", prompt)
        self.assertIn("PRESENTATION STYLE: Academic", prompt)

    def test_topic_only_generation_uses_retrieved_material_and_rejects_empty_index(self):
        groq_client = create_groq_client(json.dumps({"slides": self.slides}))
        retrieved = [
            {
                "text": self.documents[0],
                "source": "neural.pdf",
                "page": 2,
            }
        ]
        with (
            patch.object(main, "retrieve_documents", return_value=retrieved) as retrieve,
            patch.object(main, "client", groq_client),
        ):
            response = self.client.post(
                "/api/presentations/generate",
                json={
                    "topic": "Neural networks",
                    "slide_count": 3,
                },
            )
            retrieve.assert_called_once_with("Neural networks", top_k=20)
            retrieve.return_value = []
            no_material = self.client.post(
                "/api/presentations/generate",
                json={
                    "topic": "No indexed content",
                    "slide_count": 3,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sources"], ["neural.pdf"])
        self.assertEqual(no_material.status_code, 404)

    def test_rejects_unselected_citations_and_invalid_slide_count(self):
        invalid_slides = [
            {**slide, "source": "statistics.pdf", "page": "5"}
            for slide in self.slides
        ]
        groq_client = create_groq_client(json.dumps({"slides": invalid_slides}))
        with (
            patch.object(main, "get_collection", return_value=self.collection),
            patch.object(main, "client", groq_client),
        ):
            invalid_citation = self.client.post(
                "/api/presentations/generate",
                json=self.request,
            )
            invalid_count = self.client.post(
                "/api/presentations/generate",
                json={**self.request, "slide_count": 21},
            )

        self.assertEqual(invalid_citation.status_code, 502)
        self.assertIn("invalid presentation", invalid_citation.json()["detail"])
        self.assertEqual(invalid_count.status_code, 422)

    def test_exports_editable_pptx_with_slide_text_and_citations(self):
        request = {
            "title": "Neural networks",
            "language": "English",
            "style": "Academic",
            "slides": self.slides,
        }
        response = self.client.post("/api/presentations/pptx", json=request)

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            response.headers["content-type"],
        )
        self.assertIn("attachment;", response.headers["content-disposition"])
        deck = Presentation(BytesIO(response.content))
        self.assertEqual(len(deck.slides), 3)
        slide_text = "\n".join(
            shape.text
            for slide in deck.slides
            for shape in slide.shapes
            if shape.has_text_frame
        )
        self.assertIn("Neural networks - part 1", slide_text)
        self.assertIn("Networks use connected layers.", slide_text)
        self.assertIn("Source: neural.pdf", slide_text)

    def test_returns_clear_error_when_groq_is_unavailable(self):
        with patch.object(main, "client", None):
            response = self.client.post(
                "/api/presentations/generate",
                json=self.request,
            )
        self.assertEqual(response.status_code, 500)
        self.assertIn("GROQ_API_KEY", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
