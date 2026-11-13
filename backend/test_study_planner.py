import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

rag_stub = ModuleType("rag")
rag_stub.retrieve_documents = lambda *_args, **_kwargs: []
rag_stub.get_collection = lambda: None
rag_stub.get_model = lambda: None
sys.modules["rag"] = rag_stub

import main
from chat_history import Base, StudyPlan, StudyTask, get_db


def create_groq_client(contents):
    completions = []
    for content in contents:
        completions.append(
            SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content=content)
                    )
                ]
            )
        )
    return SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=Mock(side_effect=completions)
            )
        )
    )


class StudyPlannerApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = TemporaryDirectory()
        cls.test_engine = create_engine(
            f"sqlite:///{(Path(cls.temp_dir.name) / 'study-planner.db').as_posix()}",
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
        main.app.dependency_overrides.pop(get_db, None)
        cls.test_engine.dispose()
        cls.temp_dir.cleanup()

    def setUp(self):
        Base.metadata.drop_all(bind=self.test_engine)
        Base.metadata.create_all(bind=self.test_engine)
        self.today = date.today()
        self.tomorrow = self.today + timedelta(days=1)
        self.exam_date = self.today + timedelta(days=3)
        self.subject = {
            "subject": "Biology",
            "exam_date": self.exam_date.isoformat(),
            "topics": [
                {"name": "Cell division", "difficulty": "Hard"},
            ],
        }
        self.request = {
            "subjects": [self.subject],
            "available_hours": 2,
            "start_time": "09:30",
            "selected_sources": ["biology.pdf"],
        }
        self.records = [
            {
                "source": "biology.pdf",
                "page": "2",
                "chunk": 0,
                "text": "Cell division includes mitosis and meiosis.",
            },
            {
                "source": "chemistry.pdf",
                "page": "8",
                "chunk": 0,
                "text": "Chemical bonds share or transfer electrons.",
            },
        ]
        self.tasks = [
            {
                "scheduled_date": self.today.isoformat(),
                "subject": "Biology",
                "topic": "Cell division",
                "title": "Review mitosis stages",
                "duration_minutes": 45,
                "task_type": "study",
                "citations": [{"source": "biology.pdf", "page": "2"}],
            },
            {
                "scheduled_date": self.today.isoformat(),
                "subject": "Biology",
                "topic": "Break",
                "title": "Take a short break",
                "duration_minutes": 10,
                "task_type": "break",
                "citations": [],
            },
            {
                "scheduled_date": self.tomorrow.isoformat(),
                "subject": "Biology",
                "topic": "Cell division",
                "title": "Recall meiosis without notes",
                "duration_minutes": 30,
                "task_type": "revision",
                "citations": [{"source": "biology.pdf", "page": "2"}],
            },
        ]

    def _generate(self, responses=None):
        groq_client = create_groq_client(
            [json.dumps({"tasks": self.tasks})]
            if responses is None
            else responses
        )
        with (
            patch.object(main, "_indexed_document_records", return_value=self.records),
            patch.object(main, "client", groq_client),
        ):
            response = self.client.post(
                "/api/study-planner/generate",
                json=self.request,
            )
        return response, groq_client

    def test_generate_uses_selected_pdf_retries_schema_and_persists_plan(self):
        response, groq_client = self._generate(
            [
                '{"tasks": []}',
                json.dumps({"tasks": self.tasks}),
            ]
        )

        self.assertEqual(response.status_code, 201)
        result = response.json()
        self.assertEqual(result["sources"], ["biology.pdf"])
        self.assertEqual(len(result["tasks"]), 3)
        self.assertEqual(result["tasks"][0]["start_time"], "09:30")
        self.assertEqual(result["tasks"][1]["start_time"], "10:15")
        self.assertEqual(result["tasks"][2]["start_time"], "09:30")
        self.assertEqual(result["tasks"][0]["citations"][0]["source"], "biology.pdf")
        self.assertEqual(groq_client.chat.completions.create.call_count, 2)

        first_prompt = groq_client.chat.completions.create.call_args_list[0].kwargs[
            "messages"
        ][1]["content"]
        retry_prompt = groq_client.chat.completions.create.call_args_list[1].kwargs[
            "messages"
        ][-1]["content"]
        self.assertIn("Cell division includes mitosis and meiosis.", first_prompt)
        self.assertNotIn("Chemical bonds share", first_prompt)
        self.assertIn("Hard", first_prompt)
        self.assertIn(
            "exams that are sooner",
            groq_client.chat.completions.create.call_args_list[0].kwargs[
                "messages"
            ][0]["content"],
        )
        self.assertIn("failed validation", retry_prompt)

        saved = self.client.get("/api/study-planner")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(len(saved.json()["plans"]), 1)
        self.assertEqual(saved.json()["plans"][0]["id"], result["id"])
        with self.session_factory() as db:
            self.assertEqual(db.query(StudyPlan).count(), 1)
            self.assertEqual(db.query(StudyTask).count(), 3)

    def test_tasks_can_be_completed_edited_rescheduled_and_deleted(self):
        generated, _ = self._generate()
        self.assertEqual(generated.status_code, 201)
        plan = generated.json()
        study_task = plan["tasks"][0]
        break_task = plan["tasks"][1]

        updated = self.client.patch(
            f"/api/study-planner/tasks/{study_task['id']}",
            json={
                "title": "Practice cell-division recall",
                "topic": "Cell division",
                "scheduled_date": self.tomorrow.isoformat(),
                "duration_minutes": 50,
                "completed": True,
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["scheduled_date"], self.tomorrow.isoformat())
        self.assertEqual(updated.json()["title"], "Practice cell-division recall")
        self.assertEqual(updated.json()["status"], "completed")

        overdue = self.client.patch(
            f"/api/study-planner/tasks/{study_task['id']}",
            json={
                "scheduled_date": (self.today - timedelta(days=1)).isoformat(),
                "completed": False,
            },
        )
        self.assertEqual(overdue.status_code, 200)
        self.assertEqual(overdue.json()["status"], "overdue")

        long_break = self.client.patch(
            f"/api/study-planner/tasks/{break_task['id']}",
            json={"duration_minutes": 30},
        )
        self.assertEqual(long_break.status_code, 422)

        deleted = self.client.delete(
            f"/api/study-planner/tasks/{break_task['id']}"
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])

        saved = self.client.get("/api/study-planner").json()["plans"][0]
        self.assertEqual(len(saved["tasks"]), 2)
        self.assertEqual(
            next(task for task in saved["tasks"] if task["id"] == study_task["id"])[
                "start_time"
            ],
            "09:30",
        )
        self.assertEqual(
            self.client.patch(
                "/api/study-planner/tasks/missing-task",
                json={"completed": True},
            ).status_code,
            404,
        )

    def test_invalid_timetable_and_overbooked_schedule_return_clear_errors(self):
        invalid_tasks = [dict(task) for task in self.tasks]
        invalid_tasks[0]["citations"] = [
            {"source": "chemistry.pdf", "page": "8"}
        ]
        invalid_response, _ = self._generate(
            [
                json.dumps({"tasks": invalid_tasks}),
                json.dumps({"tasks": invalid_tasks}),
            ]
        )
        self.assertEqual(invalid_response.status_code, 502)
        self.assertIn("selected PDFs", invalid_response.json()["detail"])

        self.request["available_hours"] = 0.5
        overbooked_response, _ = self._generate(
            [
                json.dumps({"tasks": self.tasks}),
                json.dumps({"tasks": self.tasks}),
            ]
        )
        self.assertEqual(overbooked_response.status_code, 502)
        self.assertIn("available study hours", overbooked_response.json()["detail"])
        self.assertEqual(self.client.get("/api/study-planner").json()["plans"], [])

    def test_input_validation_and_groq_configuration_errors(self):
        invalid_date = dict(self.request)
        invalid_date["subjects"] = [
            {**self.subject, "exam_date": self.today.isoformat()}
        ]
        response = self.client.post(
            "/api/study-planner/generate",
            json=invalid_date,
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("exam dates", response.json()["detail"])

        with patch.object(main, "client", None):
            no_groq = self.client.post(
                "/api/study-planner/generate",
                json=self.request,
            )
        self.assertEqual(no_groq.status_code, 500)

        with patch.object(
            main,
            "_indexed_document_sources",
            return_value=["biology.pdf"],
        ):
            sources = self.client.get("/api/study-planner/sources")
        self.assertEqual(sources.json()["sources"], ["biology.pdf"])


if __name__ == "__main__":
    unittest.main()
