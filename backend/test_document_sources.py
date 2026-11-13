import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
rag_stub = ModuleType("rag")
rag_stub.retrieve_documents = lambda *_args, **_kwargs: []
rag_stub.get_collection = lambda: None
rag_stub.get_model = lambda: None
sys.modules["rag"] = rag_stub

import main


SOURCE_ROUTES = (
    "/api/notes/sources",
    "/api/quiz/sources",
    "/api/exam/sources",
    "/api/presentations/sources",
    "/api/research/sources",
)


class DocumentSourceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main._invalidate_document_sources_cache()

    def tearDown(self):
        main._invalidate_document_sources_cache()

    def test_all_tool_routes_share_one_metadata_only_lookup(self):
        collection = SimpleNamespace(
            get=Mock(return_value={
                "metadatas": [
                    {"source": "zeta.pdf"},
                    {"source": "alpha.pdf"},
                    {"source": "zeta.pdf"},
                    {},
                ],
            })
        )

        with patch.object(main, "get_collection", return_value=collection):
            responses = [self.client.get(route) for route in SOURCE_ROUTES]

        for response in responses:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {
                "sources": ["alpha.pdf", "zeta.pdf"],
            })
        collection.get.assert_called_once_with(include=["metadatas"])

    def test_source_cache_invalidation_refreshes_after_document_upload(self):
        collection = SimpleNamespace(
            get=Mock(side_effect=[
                {"metadatas": [{"source": "first.pdf"}]},
                {"metadatas": [{"source": "first.pdf"}, {"source": "new.pdf"}]},
            ])
        )

        with patch.object(main, "get_collection", return_value=collection):
            first = self.client.get(SOURCE_ROUTES[0])
            main._invalidate_document_sources_cache()
            second = self.client.get(SOURCE_ROUTES[-1])

        self.assertEqual(first.json()["sources"], ["first.pdf"])
        self.assertEqual(second.json()["sources"], ["first.pdf", "new.pdf"])
        self.assertEqual(collection.get.call_count, 2)

    def test_source_route_reports_index_errors_and_allows_127_frontend_origin(self):
        with patch.object(
            main,
            "get_collection",
            side_effect=RuntimeError("index unavailable"),
        ):
            response = self.client.get(SOURCE_ROUTES[0])

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json()["detail"],
            "Uploaded lecture documents could not be loaded.",
        )

        cors_response = self.client.get(
            "/health",
            headers={"Origin": "http://127.0.0.1:5173"},
        )
        self.assertEqual(
            cors_response.headers.get("access-control-allow-origin"),
            "http://127.0.0.1:5173",
        )


if __name__ == "__main__":
    unittest.main()
