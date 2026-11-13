import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

rag_stub = ModuleType("rag")
rag_stub.retrieve_documents = lambda *_args, **_kwargs: []
rag_stub.get_collection = lambda: None
rag_stub.get_model = lambda: None
sys.modules["rag"] = rag_stub

sys.path.insert(0, str(Path(__file__).parent))
import main


def create_groq_client(*contents):
    responses = [
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=content)
                )
            ]
        )
        for content in contents
    ]
    return SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=Mock(side_effect=responses))
        )
    )


class CodeAssistantApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.request = {
            "language": "python",
            "code": "",
            "instruction": "Create a greeting function",
            "task": "generate",
        }

    def test_generation_passes_json_text_to_validator_and_uses_language_value(self):
        groq_client = create_groq_client(
            json.dumps(
                {
                    "code": "def greet():\n    return 'hello'",
                    "explanation": "Defines a greeting function.",
                }
            )
        )
        with patch.object(main, "client", groq_client):
            response = self.client.post("/api/code/generate", json=self.request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["language"], "python")
        self.assertEqual(
            response.json()["generated_code"],
            "def greet():\n    return 'hello'",
        )
        self.assertEqual(groq_client.chat.completions.create.call_count, 1)
        user_prompt = groq_client.chat.completions.create.call_args.kwargs[
            "messages"
        ][1]["content"]
        self.assertIn("PROGRAMMING LANGUAGE: python", user_prompt)
        self.assertNotIn("CodeLanguage.PYTHON", user_prompt)

    def test_schema_failure_retries_and_returns_second_valid_response(self):
        groq_client = create_groq_client(
            json.dumps({"code": "print('hello')"}),
            "```json\n"
            + json.dumps(
                {
                    "code": "print('hello')",
                    "explanation": "Prints a greeting.",
                }
            )
            + "\n```",
        )
        with patch.object(main, "client", groq_client):
            response = self.client.post("/api/code/generate", json=self.request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(groq_client.chat.completions.create.call_count, 2)
        retry_prompt = groq_client.chat.completions.create.call_args_list[1].kwargs[
            "messages"
        ][-1]["content"]
        self.assertIn("missing or empty 'explanation'", retry_prompt)

    def test_conversion_uses_requested_target_when_groq_omits_it(self):
        groq_client = create_groq_client(
            json.dumps(
                {
                    "converted_code": "public class Main {}",
                    "explanation": "Converted to Java.",
                }
            )
        )
        request = {
            **self.request,
            "code": "print('hello')",
            "task": "convert",
            "target_language": "java",
        }
        with patch.object(main, "client", groq_client):
            response = self.client.post("/api/code/generate", json=request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["from_language"], "python")
        self.assertEqual(response.json()["to_language"], "java")

        request.pop("target_language")
        with patch.object(main, "client", groq_client):
            missing_target = self.client.post(
                "/api/code/generate",
                json=request,
            )
        self.assertEqual(missing_target.status_code, 422)
        self.assertIn("Choose a target language", missing_target.json()["detail"])

    def test_code_transformation_tasks_require_source_code(self):
        response = self.client.post(
            "/api/code/generate",
            json={
                **self.request,
                "task": "fix",
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("Provide code", response.json()["detail"][0]["msg"])


if __name__ == "__main__":
    unittest.main()
