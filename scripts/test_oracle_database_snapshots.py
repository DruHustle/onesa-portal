"""Isolated snapshot target, Robot consistency and stale-backup alarm regressions."""

import datetime
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "infra/oracle/operations"))
import database_snapshots as snapshots
import monitor


class SnapshotSafety(unittest.TestCase):
    def test_private_postgres_declines_hosted_defaults_and_weak_tls(self):
        uri = urlsplit("postgresql://reader:fixture@private.invalid/production")
        with patch.object(snapshots.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "Unsupported PostgreSQL target"):
                snapshots.pg_snapshot(uri)
            with self.assertRaisesRegex(ValueError, "requires verify-full TLS"):
                snapshots.pg_snapshot(uri, binding={"network_id": "a" * 64, "ca": b"test"})
            run.assert_not_called()

    def test_private_postgres_declines_changed_ca_or_network(self):
        ca = b"synthetic CA"
        profile = {
            "network_id": "a" * 64,
            "ca_path": "/etc/onesa/test.crt",
            "ca_sha256": hashlib.sha256(ca).hexdigest(),
        }
        with (
            patch.object(snapshots.database_target, "private_bytes", return_value=ca) as read,
            patch.object(snapshots.database_target, "inspect") as inspect,
            patch.object(snapshots.ssl, "SSLContext") as context,
        ):
            with self.assertRaisesRegex(ValueError, "CA changed"):
                snapshots.private_postgres_binding(dict(profile, ca_sha256="b" * 64))
            inspect.assert_not_called()
            inspect.return_value = {"Id": "b" * 64, "Driver": "bridge", "Scope": "local"}
            with self.assertRaisesRegex(ValueError, "network changed"):
                snapshots.private_postgres_binding(profile)
            inspect.return_value["Id"] = profile["network_id"]
            self.assertEqual(
                snapshots.private_postgres_binding(profile),
                {"network_id": profile["network_id"], "ca": ca},
            )
            read.assert_called_with(profile["ca_path"], limit=16384)
            context.return_value.load_verify_locations.assert_called_with(cadata=ca.decode("ascii"))

    def test_private_postgres_uses_pinned_network_and_cleans_tls_files_on_failure(self):
        uri = urlsplit("postgresql://reader:fixture@private.invalid/production?sslmode=verify-full")
        binding = {"network_id": "a" * 64, "ca": b"synthetic CA"}
        commands = []

        def docker(command, **kwargs):
            self.assertEqual(kwargs["env"], snapshots.database_target.PROCESS_ENV)
            self.assertEqual(command[:len(snapshots.database_target.DOCKER)], snapshots.database_target.DOCKER)
            action = command[len(snapshots.database_target.DOCKER)]
            commands.append(action)
            if action == "run":
                network = command.index("--network")
                self.assertEqual(command[network + 1], binding["network_id"])
                mounts = {argument.split(":", 1)[1]: Path(argument.split(":", 1)[0])
                          for argument in command if argument.startswith(str(state) + "/")}
                self.assertEqual(mounts["/secrets/database-ca.crt:ro"].read_bytes(), binding["ca"])
                config = mounts["/secrets/pg.conf:ro"].read_text()
                self.assertIn("\ndbname=production\n", config)
                self.assertIn("\nsslmode=verify-full\n", config)
                self.assertIn("\nsslrootcert=/secrets/database-ca.crt\n", config)
                self.assertIn("\noptions=-c default_transaction_read_only=on\n", config)
                self.assertNotIn("fixture", " ".join(command))
                return subprocess.CompletedProcess(command, 1, b"", b"")
            return subprocess.CompletedProcess(command, 0, b"", b"")

        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            with (
                patch.object(snapshots, "STATE", state),
                patch.object(snapshots.subprocess, "run", side_effect=docker),
            ):
                with self.assertRaisesRegex(ValueError, "Snapshot command failed"):
                    snapshots.pg_snapshot(uri, binding=binding)
            self.assertEqual(commands, ["run", "rm"])
            self.assertEqual(list(state.iterdir()), [])

    def test_private_postgres_profile_change_during_upload_preserves_receipt(self):
        config = {"schema": 1, "products": {"ai": {"private_postgres": {}}}}
        active_config = config
        uri = urlsplit("postgresql://reader:fixture@private.invalid/production?sslmode=verify-full")
        binding = {"network_id": "a" * 64, "ca": b"synthetic CA"}

        def read_profile(path):
            if path == snapshots.CONFIG:
                return active_config
            return {"image": "onesa-portal-worker:" + "a" * 40}

        def upload(command, **kwargs):
            nonlocal active_config
            active_config = {"schema": 1, "products": {"ai": {}}}
            payload = json.loads(kwargs["input"])
            receipt = {"passed": True, "product": "ai", "id": payload["id"]}
            return subprocess.CompletedProcess(command, 0, json.dumps(receipt).encode(), b"")

        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            success = state / "database-backup-ai-success.json"
            previous_receipt = '{"id":"prior-snapshot"}\n'
            success.write_text(previous_receipt)
            with (
                patch.object(snapshots.os, "geteuid", return_value=0),
                patch.object(snapshots, "STATE", state),
                patch.object(snapshots, "private_json", side_effect=read_profile),
                patch.object(snapshots, "settings_for", return_value=({}, uri)),
                patch.object(snapshots, "private_postgres_binding", return_value=binding),
                patch.object(snapshots, "pg_snapshot", return_value=(b"synthetic dump", [])),
                patch.object(snapshots.backup, "checked_env"),
                patch.object(snapshots.subprocess, "run", side_effect=upload) as transport,
            ):
                with self.assertRaisesRegex(ValueError, "Private PostgreSQL snapshot profile changed"):
                    snapshots.main("ai")
            transport.assert_called_once()
            self.assertEqual(success.read_text(), previous_receipt)

    def test_robot_rejects_other_environment_before_network(self):
        from urllib.parse import urlsplit

        with patch("urllib.request.build_opener") as opener:
            with self.assertRaises(ValueError):
                snapshots.robot_snapshot({}, urlsplit("libsql://staging.example"))
            opener.assert_not_called()

    def test_private_configuration_rejects_symlink_and_open_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "config"
            p.write_text("{}")
            p.chmod(0o644)
            with self.assertRaises(ValueError):
                snapshots.private_json(p)
            link = Path(directory) / "link"
            link.symlink_to(p)
            with self.assertRaises(ValueError):
                snapshots.private_json(link)

    def test_one_statement_snapshot_and_exact_schema_coverage(self):
        import urllib.parse

        row = {
            "schema_count": "2",
            "tasks_schema": "CREATE TABLE robot_simulation_tasks_v1 (id TEXT)",
            "tasks_rows": '[{"id":"synthetic"}]',
            "lease_schema": "CREATE TABLE robot_simulation_lease_v1 (id INTEGER)",
            "lease_rows": "[]",
        }

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                result = {
                    "cols": [{"name": k} for k in row],
                    "rows": [[{"type": "text", "value": v} for v in row.values()]],
                }
                return json.dumps(
                    {
                        "results": [
                            {"type": "ok", "response": {"result": result}},
                            {"type": "ok"},
                        ]
                    }
                ).encode()

        class Opener:
            def open(self, request, **_):
                statements = json.loads(request.data)["requests"]
                assert len(statements) == 2 and statements[0]["stmt"]["sql"].startswith(
                    "SELECT"
                )
                assert statements[1] == {"type": "close"}
                return Response()

        uri = urllib.parse.urlsplit(
            "libsql://onesa-ai-robot-backend-druhustle.aws-eu-west-1.turso.io"
        )
        with patch("urllib.request.build_opener", return_value=Opener()):
            payload, manifest = snapshots.robot_snapshot(
                {"ROBOT_TURSO_AUTH_TOKEN": "synthetic-only"}, uri
            )
            self.assertEqual(len(json.loads(payload)["tables"]), 2)
            self.assertEqual(
                manifest[0]["sha256"],
                hashlib.sha256(row["tasks_rows"].encode()).hexdigest(),
            )
            row["schema_count"] = "3"
            with self.assertRaises(ValueError):
                snapshots.robot_snapshot(
                    {"ROBOT_TURSO_AUTH_TOKEN": "synthetic-only"}, uri
                )

    def test_missing_stale_future_failed_or_wrong_product_receipt_alerts(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            p = state / "database-backup-ai-success.json"
            self.assertTrue(
                monitor.database_backup_health(["ai"], state, now.timestamp())[
                    "database_backup_failed"
                ]
            )
            receipt = {
                "verified_at": now.isoformat(),
                "product": "ai",
                "passed": True,
                "off_instance_storage_verified": True,
                "consistent_snapshot": True,
            }
            p.write_text(json.dumps(receipt))
            self.assertFalse(
                monitor.database_backup_health(["ai"], state, now.timestamp())[
                    "database_backup_failed"
                ]
            )
            self.assertTrue(
                monitor.database_backup_health(["ai"], state, now.timestamp() + 7201)[
                    "database_backup_failed"
                ]
            )
            self.assertTrue(
                monitor.database_backup_health(["ai"], state, now.timestamp() - 1)[
                    "database_backup_failed"
                ]
            )
            receipt["product"] = "robot"
            p.write_text(json.dumps(receipt))
            self.assertTrue(
                monitor.database_backup_health(["ai"], state, now.timestamp())[
                    "database_backup_failed"
                ]
            )
            receipt["product"] = "ai"
            p.write_text(json.dumps(receipt))
            (state / "database-backup-ai-failure.json").write_text("{}")
            self.assertTrue(
                monitor.database_backup_health(["ai"], state, now.timestamp())[
                    "database_backup_failed"
                ]
            )




class BootstrapSafety(unittest.TestCase):
    def test_existing_install_stops_before_source_config_or_key_writes(self):
        import oracle_operations

        with (
            patch.object(oracle_operations.worker, "qualified_source", return_value=[]),
            patch.object(
                oracle_operations, "run", side_effect=ValueError("Already installed")
            ) as command,
            patch.object(oracle_operations, "public_key") as key,
        ):
            with self.assertRaises(ValueError):
                oracle_operations.install("a" * 40)
            command.assert_called_once_with(
                "sudo test ! -e /etc/onesa/operations.json", timeout=20
            )
            key.assert_not_called()

    def test_archive_includes_encryption_module(self):
        import oracle_operations

        self.assertIn("scripts/oracle_backup_payload.mjs", oracle_operations.PATHS)


if __name__ == "__main__":
    unittest.main()
