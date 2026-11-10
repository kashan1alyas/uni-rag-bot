import json
import unittest
from datetime import date, timedelta
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

rag_stub = ModuleType("rag")
rag_stub.retrieve_documents = lambda *_args, **_kwargs: []
rag_stub.get_collection = lambda: None
rag_stub.get_model = lambda: None
sys.modules["rag"] = rag_stub

import main
from chat_history import Base, DATABASE_PATH, Message, engine, get_db


class ChatHistoryApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = TemporaryDirectory()
        cls.test_engine = create_engine(
            f"sqlite:///{(Path(cls.temp_dir.name) / 'test.db').as_posix()}",
            connect_args={"check_same_thread": False},
        )
        cls.session_factory = sessionmaker(
            bind=cls.test_engine,
            autoflush=False,
            expire_on_commit=False,
        )
        Base.metadata.create_all(bind=cls.test_engine)

        def override_get_db():
            db = cls.session_factory()
            try:
                yield db
            finally:
                db.close()

        cls.override_get_db = staticmethod(override_get_db)
        main.app.dependency_overrides[get_db] = cls.override_get_db
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        main.app.dependency_overrides.clear()
        cls.test_engine.dispose()
        cls.temp_dir.cleanup()

    def setUp(self):
        Base.metadata.drop_all(bind=self.test_engine)
        Base.metadata.create_all(bind=self.test_engine)

    def test_sqlite_database_and_tables_are_created_automatically(self):
        self.assertTrue(DATABASE_PATH.is_file())
        self.assertEqual(
            set(inspect(engine).get_table_names()),
            {"conversations", "messages"},
        )

    def test_create_list_load_append_rename_and_delete_conversation(self):
        created = self.client.post(
            "/api/conversations",
            json={
                "id": "test-conversation",
                "title": "New chat",
                "messages": [],
                "createdAt": 1000,
                "updatedAt": 1000,
            },
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["id"], "test-conversation")

        saved = self.client.post(
            "/api/conversations/test-conversation/messages",
            json={
                "role": "user",
                "content": "Explain regression",
                "timestamp": 2000,
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["title"], "Explain regression")

        saved = self.client.post(
            "/api/conversations/test-conversation/messages",
            json={
                "role": "assistant",
                "content": "Regression models relationships.",
                "sources": [{"filename": "lecture.pdf", "page": 3}],
                "timestamp": 3000,
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(len(saved.json()["messages"]), 2)

        listing = self.client.get("/api/conversations")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(
            listing.json()["conversations"][0]["title"],
            "Explain regression",
        )

        loaded = self.client.get("/api/conversations/test-conversation")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["messages"][1]["sources"][0]["page"], 3)

        renamed = self.client.patch(
            "/api/conversations/test-conversation",
            json={"title": "Regression notes"},
        )
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["title"], "Regression notes")

        deleted = self.client.delete("/api/conversations/test-conversation")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        self.assertEqual(
            self.client.get("/api/conversations").json()["conversations"],
            [],
        )
        with self.session_factory() as db:
            self.assertEqual(db.query(Message).count(), 0)

    def test_validation_duplicate_and_missing_conversation_errors(self):
        invalid = self.client.post(
            "/api/conversations",
            json={"id": "invalid", "title": "Invalid", "messages": [{"role": "system", "content": "x"}]},
        )
        self.assertEqual(invalid.status_code, 422)

        self.client.post(
            "/api/conversations",
            json={"id": "duplicate", "title": "First", "messages": []},
        )
        duplicate = self.client.post(
            "/api/conversations",
            json={"id": "duplicate", "title": "Second", "messages": []},
        )
        self.assertEqual(duplicate.status_code, 409)

        missing = self.client.get("/api/conversations/does-not-exist")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(
            self.client.post(
                "/api/conversations/does-not-exist/messages",
                json={"role": "assistant", "content": "No conversation"},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.patch(
                "/api/conversations/does-not-exist",
                json={"title": "Missing"},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete("/api/conversations/does-not-exist").status_code,
            404,
        )

    def test_database_errors_return_clear_service_unavailable_response(self):
        def broken_get_db():
            class BrokenSession:
                def query(self, *_args, **_kwargs):
                    raise OperationalError("SELECT", {}, Exception("disk unavailable"))

                def close(self):
                    pass

            yield BrokenSession()

        main.app.dependency_overrides[get_db] = broken_get_db
        try:
            response = self.client.get("/api/conversations")
            self.assertEqual(response.status_code, 503)
            self.assertIn("database operation failed", response.json()["detail"])
        finally:
            main.app.dependency_overrides[get_db] = self.override_get_db

    def test_notes_sources_generation_document_filter_and_pdf_export(self):
        documents = [
            "Linear regression models a relationship.",
            "The slope is a formula.",
            "Neural networks contain layers.",
        ]
        metadatas = [
            {"source": "linear.pdf", "page": 1, "chunk": 0},
            {"source": "linear.pdf", "page": 2, "chunk": 1},
            {"source": "neural.pdf", "page": 4, "chunk": 0},
        ]
        collection = SimpleNamespace(
            count=lambda: len(documents),
            get=lambda **_kwargs: {
                "documents": documents,
                "metadatas": metadatas,
            },
        )
        groq_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="# Linear regression\n\n- A relationship model. (linear.pdf, p. 1)"
                    )
                )
            ]
        )
        groq_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=Mock(return_value=groq_response))
            )
        )

        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "client", groq_client),
        ):
            sources = self.client.get("/api/notes/sources")
            self.assertEqual(sources.status_code, 200)
            self.assertEqual(sources.json()["sources"], ["linear.pdf", "neural.pdf"])

            generated = self.client.post(
                "/api/notes",
                json={
                    "note_type": "topic_wise",
                    "selected_sources": ["linear.pdf"],
                },
            )
            self.assertEqual(generated.status_code, 200)
            self.assertEqual(generated.json()["sources"], ["linear.pdf"])
            prompt = groq_client.chat.completions.create.call_args.kwargs[
                "messages"
            ][1]["content"]
            self.assertIn("Linear regression models a relationship.", prompt)
            self.assertNotIn("Neural networks contain layers.", prompt)
            self.assertIn("Organize the notes", prompt)

            all_notes = self.client.post(
                "/api/notes",
                json={"note_type": "short", "all_documents": True},
            )
            self.assertEqual(
                all_notes.json()["sources"],
                ["linear.pdf", "neural.pdf"],
            )

            pdf = self.client.post(
                "/api/notes/pdf",
                json={
                    "title": "Linear Regression",
                    "notes": generated.json()["notes"],
                    "sources": ["linear.pdf"],
                },
            )
            self.assertEqual(pdf.status_code, 200)
            self.assertEqual(pdf.headers["content-type"], "application/pdf")
            self.assertTrue(pdf.content.startswith(b"%PDF-"))
            with main.pymupdf.open(stream=pdf.content, filetype="pdf") as notes_pdf:
                extracted_pdf_text = "\n".join(
                    page.get_text() for page in notes_pdf
                )
            self.assertIn("Linear Regression", extracted_pdf_text)
            self.assertIn("linear.pdf", extracted_pdf_text)

    def test_notes_validation_empty_documents_and_groq_configuration_errors(self):
        collection = SimpleNamespace(
            count=lambda: 0,
            get=lambda **_kwargs: {"documents": [], "metadatas": []},
        )
        with patch.object(main, "get_collection", return_value=collection):
            empty_sources = self.client.get("/api/notes/sources")
            self.assertEqual(empty_sources.json()["sources"], [])

            missing_selection = self.client.post(
                "/api/notes",
                json={"note_type": "short"},
            )
            self.assertEqual(missing_selection.status_code, 422)

            no_documents = self.client.post(
                "/api/notes",
                json={"note_type": "short", "all_documents": True},
            )
            self.assertEqual(no_documents.status_code, 404)

        with patch.object(main, "client", None):
            no_groq_key = self.client.post(
                "/api/notes",
                json={"note_type": "short", "all_documents": True},
            )
        self.assertEqual(no_groq_key.status_code, 500)

    def test_quiz_generation_uses_selected_sources_and_returns_all_question_types(self):
        documents = [
            "Linear regression models a relationship.",
            "The slope represents the change in the dependent variable.",
            "Neural networks contain layers of connected units.",
        ]
        metadatas = [
            {"source": "linear.pdf", "page": 1, "chunk": 0},
            {"source": "linear.pdf", "page": 2, "chunk": 1},
            {"source": "neural.pdf", "page": 4, "chunk": 0},
        ]
        collection = SimpleNamespace(
            count=lambda: len(documents),
            get=lambda **_kwargs: {
                "documents": documents,
                "metadatas": metadatas,
            },
        )
        generated_questions = [
            {
                "question_type": "mcq",
                "question": "What does linear regression model?",
                "options": [
                    "A relationship",
                    "A network layer",
                    "A classification tree",
                    "A data source",
                ],
                "correct_answer": "A relationship",
                "explanation": "The lecture states that linear regression models a relationship.",
                "source": "linear.pdf",
                "page": "1",
            },
            {
                "question_type": "true_false",
                "question": "The slope represents a change in the dependent variable.",
                "options": [],
                "correct_answer": "True",
                "explanation": "This is stated in the selected lecture.",
                "source": "linear.pdf",
                "page": "2",
            },
            {
                "question_type": "short_answer",
                "question": "What does linear regression model?",
                "options": [],
                "correct_answer": "A relationship",
                "explanation": "The selected lecture describes linear regression this way.",
                "source": "linear.pdf",
                "page": "1",
            },
        ]
        groq_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps({"questions": generated_questions})
                    )
                )
            ]
        )
        groq_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=Mock(return_value=groq_response))
            )
        )

        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "client", groq_client),
        ):
            sources = self.client.get("/api/quiz/sources")
            self.assertEqual(sources.status_code, 200)
            self.assertEqual(sources.json()["sources"], ["linear.pdf", "neural.pdf"])

            response = self.client.post(
                "/api/quiz",
                json={
                    "question_count": 3,
                    "difficulty": "Hard",
                    "selected_sources": ["linear.pdf"],
                },
            )
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result["difficulty"], "Hard")
            self.assertEqual(result["sources"], ["linear.pdf"])
            self.assertEqual(len(result["questions"]), 3)
            self.assertEqual(
                {question["question_type"] for question in result["questions"]},
                {"mcq", "true_false", "short_answer"},
            )
            prompt = groq_client.chat.completions.create.call_args.kwargs[
                "messages"
            ][1]["content"]
            self.assertIn("QUESTION COUNT: 3", prompt)
            self.assertIn("DIFFICULTY: Hard", prompt)
            self.assertIn("Linear regression models a relationship.", prompt)
            self.assertNotIn("Neural networks contain layers", prompt)
            self.assertEqual(
                groq_client.chat.completions.create.call_args.kwargs[
                    "response_format"
                ],
                {"type": "json_object"},
            )

            all_documents = self.client.post(
                "/api/quiz",
                json={
                    "question_count": 3,
                    "difficulty": "Easy",
                    "all_documents": True,
                },
            )
            self.assertEqual(all_documents.status_code, 200)
            self.assertEqual(
                all_documents.json()["sources"],
                ["linear.pdf", "neural.pdf"],
            )
            all_prompt = groq_client.chat.completions.create.call_args.kwargs[
                "messages"
            ][1]["content"]
            self.assertIn("Neural networks contain layers", all_prompt)

    def test_quiz_validation_empty_sources_and_invalid_generated_content(self):
        empty_collection = SimpleNamespace(
            count=lambda: 0,
            get=lambda **_kwargs: {"documents": [], "metadatas": []},
        )
        quiz_request = {
            "question_count": 3,
            "difficulty": "Medium",
            "all_documents": True,
        }
        self.assertEqual(
            self.client.post(
                "/api/quiz",
                json={**quiz_request, "question_count": 2},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/quiz",
                json={**quiz_request, "difficulty": "Expert"},
            ).status_code,
            422,
        )
        with patch.object(main, "get_collection", return_value=empty_collection):
            self.assertEqual(
                self.client.get("/api/quiz/sources").json()["sources"],
                [],
            )
            self.assertEqual(
                self.client.post(
                    "/api/quiz",
                    json={**quiz_request, "all_documents": False},
                ).status_code,
                422,
            )
            self.assertEqual(
                self.client.post("/api/quiz", json=quiz_request).status_code,
                404,
            )

        with patch.object(main, "client", None):
            no_groq_key = self.client.post("/api/quiz", json=quiz_request)
        self.assertEqual(no_groq_key.status_code, 500)

        collection = SimpleNamespace(
            count=lambda: 1,
            get=lambda **_kwargs: {
                "documents": ["Only indexed excerpt."],
                "metadatas": [{"source": "lecture.pdf", "page": 1, "chunk": 0}],
            },
        )
        groq_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=Mock())
            )
        )
        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "client", groq_client),
        ):
            unknown_source = self.client.post(
                "/api/quiz",
                json={
                    "question_count": 3,
                    "difficulty": "Medium",
                    "selected_sources": ["missing.pdf"],
                },
            )
        self.assertEqual(unknown_source.status_code, 422)
        groq_client.chat.completions.create.assert_not_called()

        invalid_questions = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content='{"questions": []}')
                )
            ]
        )
        groq_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=Mock(return_value=invalid_questions))
            )
        )
        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "client", groq_client),
        ):
            invalid = self.client.post(
                "/api/quiz",
                json={
                    "question_count": 3,
                    "difficulty": "Medium",
                    "selected_sources": ["lecture.pdf"],
                },
            )
        self.assertEqual(invalid.status_code, 502)
        self.assertIn("invalid quiz", invalid.json()["detail"])

    def test_exam_plan_filters_documents_and_builds_daily_schedule(self):
        documents = [
            "Regression estimates a relationship between variables.",
            "The least-squares method minimizes the sum of squared residuals.",
            "Neural networks use connected layers of units.",
        ]
        metadatas = [
            {"source": "statistics.pdf", "page": 1, "chunk": 0},
            {"source": "statistics.pdf", "page": 2, "chunk": 1},
            {"source": "neural.pdf", "page": 5, "chunk": 0},
        ]
        collection = SimpleNamespace(
            count=lambda: len(documents),
            get=lambda **_kwargs: {
                "documents": documents,
                "metadatas": metadatas,
            },
        )
        topics = [
            {
                "topic": "Regression basics",
                "importance": "High",
                "key_concepts": ["Relationship between variables", "Regression estimates"],
                "recommended_hours": 2,
                "source": "statistics.pdf",
                "page": "1",
            },
            {
                "topic": "Least squares",
                "importance": "Medium",
                "key_concepts": ["Minimize squared residuals"],
                "recommended_hours": 1.5,
                "source": "statistics.pdf",
                "page": "2",
            },
            {
                "topic": "Residuals",
                "importance": "Low",
                "key_concepts": ["Squared residuals"],
                "recommended_hours": 1,
                "source": "statistics.pdf",
                "page": "2",
            },
        ]
        groq_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(
                    create=Mock(
                        return_value=SimpleNamespace(
                            choices=[
                                SimpleNamespace(
                                    message=SimpleNamespace(
                                        content=json.dumps({"topics": topics})
                                    )
                                )
                            ]
                        )
                    )
                )
            )
        )

        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "client", groq_client),
        ):
            sources = self.client.get("/api/exam/sources")
            self.assertEqual(
                sources.json()["sources"],
                ["neural.pdf", "statistics.pdf"],
            )

            response = self.client.post(
                "/api/exam/plan",
                json={
                    "subject": "Statistics",
                    "exam_date": (date.today() + timedelta(days=3)).isoformat(),
                    "study_hours_per_day": 2,
                    "selected_sources": ["statistics.pdf"],
                },
            )
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(len(result["topics"]), 3)
            self.assertEqual(result["sources"], ["statistics.pdf"])
            self.assertEqual(len(result["schedule"]), 3)
            self.assertEqual(
                {day["hours"] for day in result["schedule"]},
                {2},
            )
            self.assertEqual(
                result["schedule"][-1]["task"],
                "Do a final review and complete a timed practice test.",
            )
            prompt = groq_client.chat.completions.create.call_args.kwargs[
                "messages"
            ][1]["content"]
            self.assertIn("SUBJECT: Statistics", prompt)
            self.assertIn("AVAILABLE STUDY HOURS PER DAY: 2", prompt)
            self.assertIn("Regression estimates a relationship", prompt)
            self.assertNotIn("Neural networks use connected layers", prompt)

    def test_exam_practice_generates_all_question_types_for_weak_topic(self):
        documents = [
            "Regression estimates relationships and uses residuals to evaluate fit.",
            "Neural networks use connected layers of units.",
        ]
        metadatas = [
            {"source": "statistics.pdf", "page": 1, "chunk": 0},
            {"source": "neural.pdf", "page": 3, "chunk": 0},
        ]
        collection = SimpleNamespace(
            count=lambda: len(documents),
            get=lambda **_kwargs: {
                "documents": documents,
                "metadatas": metadatas,
            },
        )
        questions = [
            {
                "question_type": "mcq",
                "topic": "Regression",
                "question": "What does regression estimate?",
                "options": [
                    "Relationships",
                    "Network layers",
                    "Image labels",
                    "Sorting order",
                ],
                "correct_answer": "Relationships",
                "explanation": "The excerpt states that regression estimates relationships.",
                "source": "statistics.pdf",
                "page": "1",
            },
            {
                "question_type": "short",
                "topic": "Regression",
                "question": "What can residuals evaluate?",
                "options": [],
                "correct_answer": "Model fit",
                "explanation": "The excerpt says residuals evaluate fit.",
                "source": "statistics.pdf",
                "page": "1",
            },
            {
                "question_type": "long",
                "topic": "Regression",
                "question": "Explain how regression and residuals are related.",
                "options": [],
                "correct_answer": "Regression estimates relationships, and residuals evaluate model fit.",
                "explanation": "Both points are stated in the selected passage.",
                "source": "statistics.pdf",
                "page": "1",
            },
        ]
        groq_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(
                    create=Mock(
                        return_value=SimpleNamespace(
                            choices=[
                                SimpleNamespace(
                                    message=SimpleNamespace(
                                        content=json.dumps({"questions": questions})
                                    )
                                )
                            ]
                        )
                    )
                )
            )
        )

        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "client", groq_client),
        ):
            response = self.client.post(
                "/api/exam/practice",
                json={
                    "subject": "Statistics",
                    "question_count": 3,
                    "difficulty": "Hard",
                    "focus_topics": ["Regression"],
                    "selected_sources": ["statistics.pdf"],
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                {item["question_type"] for item in response.json()["questions"]},
                {"mcq", "short", "long"},
            )
            self.assertEqual(response.json()["focus_topics"], ["Regression"])
            prompt = groq_client.chat.completions.create.call_args.kwargs[
                "messages"
            ][1]["content"]
            self.assertIn("FOCUS TOPICS: Regression", prompt)
            self.assertIn("Regression estimates relationships", prompt)
            self.assertNotIn("Neural networks use connected layers", prompt)

    def test_exam_endpoints_return_clear_selection_date_and_model_errors(self):
        request = {
            "subject": "Statistics",
            "exam_date": (date.today() + timedelta(days=5)).isoformat(),
            "study_hours_per_day": 2,
            "all_documents": True,
        }
        empty_collection = SimpleNamespace(
            count=lambda: 0,
            get=lambda **_kwargs: {"documents": [], "metadatas": []},
        )
        with patch.object(main, "get_collection", return_value=empty_collection):
            self.assertEqual(
                self.client.post("/api/exam/plan", json=request).status_code,
                404,
            )
            self.assertEqual(
                self.client.post(
                    "/api/exam/plan",
                    json={**request, "all_documents": False},
                ).status_code,
                404,
            )
            self.assertEqual(
                self.client.get("/api/exam/sources").json()["sources"],
                [],
            )

        with patch.object(main, "client", None):
            no_groq_key = self.client.post("/api/exam/plan", json=request)
        self.assertEqual(no_groq_key.status_code, 500)

        future_collection = SimpleNamespace(
            count=lambda: 1,
            get=lambda **_kwargs: {
                "documents": ["Regression examines a relationship."],
                "metadatas": [{"source": "stats.pdf", "page": 1, "chunk": 0}],
            },
        )
        with patch.object(main, "get_collection", return_value=future_collection):
            past_date = self.client.post(
                "/api/exam/plan",
                json={**request, "exam_date": date.today().isoformat()},
            )
            bad_hours = self.client.post(
                "/api/exam/plan",
                json={**request, "study_hours_per_day": 20},
            )
            unknown_source = self.client.post(
                "/api/exam/practice",
                json={
                    "subject": "Statistics",
                    "selected_sources": ["missing.pdf"],
                },
            )
            too_many_questions = self.client.post(
                "/api/exam/practice",
                json={
                    "subject": "Statistics",
                    "question_count": 21,
                    "all_documents": True,
                },
            )
        self.assertEqual(past_date.status_code, 422)
        self.assertEqual(bad_hours.status_code, 422)
        self.assertEqual(unknown_source.status_code, 422)
        self.assertEqual(too_many_questions.status_code, 422)


if __name__ == "__main__":
    unittest.main()
