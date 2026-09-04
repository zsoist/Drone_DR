import unittest

from world_compiler.model_intake import evaluate_model_intake


def record(**updates):
    value = {
        "name": "fixture",
        "code_license": "Apache-2.0",
        "weights_license": "Apache-2.0",
        "checkpoint_sha256": "a" * 64,
        "data_egress": "none",
        "private_upload_opt_in": False,
        "intended_use": "production",
        "evaluated": True,
        "hardware_measurements": {"device": "fixture", "peak_memory_mib": 100},
        "performance_claims": {},
    }
    value.update(updates)
    return value


class ModelIntakeTests(unittest.TestCase):
    def test_complete_local_commercial_record_can_enter_production(self):
        self.assertEqual("production", evaluate_model_intake(record()))

    def test_missing_checkpoint_hash_or_license_is_rejected(self):
        self.assertEqual("rejected", evaluate_model_intake(record(checkpoint_sha256=None)))
        self.assertEqual("rejected", evaluate_model_intake(record(code_license=None)))

    def test_private_upload_requires_explicit_opt_in(self):
        result = evaluate_model_intake(record(data_egress="private_cloud_upload"))

        self.assertEqual("rejected", result)

    def test_noncommercial_weights_never_enter_production(self):
        result = evaluate_model_intake(record(weights_license="CC-BY-NC-4.0"))

        self.assertEqual("research-only", result)

    def test_unevaluated_or_unmeasured_claims_remain_research_only(self):
        self.assertEqual("research-only", evaluate_model_intake(record(evaluated=False)))
        self.assertEqual(
            "research-only",
            evaluate_model_intake(record(hardware_measurements={}, performance_claims={"fps": 60})),
        )


if __name__ == "__main__":
    unittest.main()
