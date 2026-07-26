"""Regression coverage for deprecation warnings emitted by World in Chrome."""
import unittest

from browser_gate import CDP


class BrowserConsoleWarningTests(unittest.TestCase):
    def test_console_warning_is_preserved_separately_from_errors(self):
        cdp = CDP.__new__(CDP)
        cdp.errors = []
        cdp.warnings = []

        cdp._event({
            "method": "Runtime.consoleAPICalled",
            "params": {
                "type": "warning",
                "args": [{"value": 'MeshBVH: "maxLeafTris" option has been deprecated.'}],
            },
        })

        self.assertEqual([], cdp.errors)
        self.assertEqual(
            ['console.warning: MeshBVH: "maxLeafTris" option has been deprecated.'],
            cdp.warnings,
        )


if __name__ == "__main__":
    unittest.main()
