"""Django test runner that emits authoritative per-test outcomes as JSON."""

import json
import os
from pathlib import Path
import unittest

from django.test.runner import DiscoverRunner


class RecordingResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.outcomes = {}

    def _record(self, test, status, detail):
        self.outcomes[test.id()] = {"status": status, "detail": detail}

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "pass", "unittest addSuccess")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "not_run", f"skipped: {reason}")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record(test, "not_run", "expected failure")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record(test, "fail", "unexpected success")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "fail", self._exc_info_to_string(err, test)[-1200:])

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "fail", self._exc_info_to_string(err, test)[-1200:])


class RecordingTextTestRunner(unittest.TextTestRunner):
    resultclass = RecordingResult


class RecordingDiscoverRunner(DiscoverRunner):
    test_runner = RecordingTextTestRunner

    def run_suite(self, suite, **kwargs):
        result = super().run_suite(suite, **kwargs)
        output = os.environ.get("VAL02_WAGTAIL_TEST_RESULTS")
        if output:
            Path(output).write_text(
                json.dumps(
                    {
                        "tests_run": result.testsRun,
                        "outcomes": result.outcomes,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        return result
