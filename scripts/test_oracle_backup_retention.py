"""Exercise encrypted upload, readback, and retention with an in-memory provider."""

import json
from pathlib import Path
import shutil
import subprocess
import unittest


NODE = shutil.which("node")
TRANSPORT = Path(__file__).with_name("oracle_backup_store.mjs")
IMPORT = (
    "import {S3Client,PutObjectCommand,GetObjectCommand,ListObjectsV2Command,"
    "DeleteObjectCommand} from '@aws-sdk/client-s3';"
)
MOCK = """
const originalRead = fs.readFileSync;
fs.readFileSync = (path, ...args) => path === '/recovery/public.pem'
 ? crypto.generateKeyPairSync('rsa', {
     modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' },
     privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
   }).publicKey
 : originalRead(path, ...args);
const actions = [];
process.on('exit', () => process.stderr.write(JSON.stringify(actions) + '\\n'));
class PutObjectCommand { constructor(input) { this.input = input; } }
class GetObjectCommand { constructor(input) { this.input = input; } }
class ListObjectsV2Command { constructor(input) { this.input = input; } }
class DeleteObjectCommand { constructor(input) { this.input = input; } }
class S3Client {
 async send(command) {
  const {Key, Body, ContinuationToken} = command.input;
  if (command instanceof PutObjectCommand) {
   this.created = {Key, Body};
   actions.push(['put', Key]);
   return {};
  }
  if (command instanceof GetObjectCommand && Key === this.created.Key) {
   actions.push(['readback', Key]);
   const bytes = input.corrupt ? Buffer.from('bad') : this.created.Body;
   return {ContentLength: bytes.length, Body: {transformToByteArray: async () => bytes}};
  }
  if (command instanceof ListObjectsV2Command) {
   actions.push(['list', ContinuationToken ?? null]);
   const index = Number(ContinuationToken ?? 0);
   const Contents = input.pages[index].map(({key, date}) => ({
    Key: key,
    LastModified: date === null ? undefined : new Date(date),
   }));
   return {
    Contents,
    NextContinuationToken: index + 1 < input.pages.length ? String(index + 1) : undefined,
   };
  }
  if (command instanceof DeleteObjectCommand) {
   actions.push(['delete', Key]);
   return {};
  }
  throw new Error('unexpected provider command');
 }
}
"""
PREFIX = ".onesa-portal-backups/v1/"
CURRENT = PREFIX + "f" * 32 + ".json"
PUBLICATION = "2026-11-24T02:15:00.000Z"
ENV = {
    "S3_ENDPOINT": "https://br-red-morning-b9d1sxnz.storage.c-7.eu-central-1.aws.neon.tech",
    "S3_REGION": "synthetic",
    "S3_BUCKET": "disposable-fixture",
    "SESSION_KEY": "synthetic-session-key",
}


def entry(letter, date):
    return {"key": PREFIX + letter * 32 + ".json", "date": date}


@unittest.skipUnless(NODE, "Node is required for the synthetic transport test")
class BackupRetentionTests(unittest.TestCase):
    def run_backup(self, pages, corrupt=False):
        request = {
            "action": "backup",
            "id": "f" * 32,
            "dump": "UEdETVBTWU5USEVUSUM=",
            "files": [],
            "manifest": [],
            "pages": pages,
            "corrupt": corrupt,
        }
        source = TRANSPORT.read_text()
        self.assertEqual(source.count(IMPORT), 1)
        script = f"Date.now = () => Date.parse({json.dumps(PUBLICATION)});\n" + source.replace(IMPORT, MOCK)
        process = subprocess.run(
            [NODE, "--input-type=module", "-e", script],
            input=json.dumps(request),
            capture_output=True,
            text=True,
            env=ENV,
            timeout=15,
        )
        actions = json.loads(process.stderr.splitlines()[-1])
        result = json.loads(process.stdout) if process.stdout else None
        return process.returncode, result, actions

    def test_monthly_keeps_two_distinct_previous_recovery_points(self):
        newest = entry("d", "2026-10-24")
        second = entry("c", "2026-09-24")
        old = entry("b", "2026-08-24")
        oldest = entry("a", "2026-07-24")
        escrow = {"key": PREFIX + "keys/" + "a" * 64 + ".enc", "date": "2025-11-24"}
        unlisted_date = entry("e", None)
        code, result, actions = self.run_backup([
            [newest, oldest, escrow],
            [entry("f", PUBLICATION), second, old, newest, unlisted_date],
        ])
        self.assertEqual(code, 0)
        self.assertEqual(result["retention_minimum_archives"], 3)
        self.assertEqual(result["retention_days"], 7)
        self.assertEqual(result["expired_archives_removed"], 2)
        self.assertEqual(actions[:2], [["put", CURRENT], ["readback", CURRENT]])
        deletes = [key for action, key in actions if action == "delete"]
        self.assertEqual(deletes, [old["key"], oldest["key"]])

    def test_fresh_archives_and_records_with_unknown_age_are_preserved(self):
        newest = entry("a", "2026-11-24")
        second = entry("b", "2026-11-23")
        fresh = entry("c", "2026-11-18")
        invalid = entry("d", "invalid")
        code, result, actions = self.run_backup([[newest, fresh, invalid, second]])
        self.assertEqual(code, 0)
        self.assertTrue(result["off_instance_storage_verified"])
        self.assertEqual(result["expired_archives_removed"], 0)
        self.assertNotIn("delete", [x[0] for x in actions])

    def test_failed_readback_does_not_list_or_delete_archives(self):
        older = [entry(letter, "2026-07-24") for letter in "abcd"]
        code, result, actions = self.run_backup([older], corrupt=True)
        self.assertEqual(code, 1)
        self.assertIsNone(result)
        self.assertEqual(actions, [["put", CURRENT], ["readback", CURRENT]])


if __name__ == "__main__":
    unittest.main()
