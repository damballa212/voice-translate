import importlib
import os
import tempfile
import unittest


class PushDbTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_PATH"] = os.path.join(self.tmp.name, "test.db")
        import db

        self.db = importlib.reload(db)
        self.alice = self.db.create_user("alice@example.com", "secret1", "Alice")
        self.bob = self.db.create_user("bob@example.com", "secret1", "Bob")

    def tearDown(self):
        self.tmp.cleanup()

    def test_push_subscription_is_upserted_by_endpoint(self):
        first = {
            "endpoint": "https://push.example/sub-1",
            "keys": {"p256dh": "key-a", "auth": "auth-a"},
        }
        second = {
            "endpoint": "https://push.example/sub-1",
            "keys": {"p256dh": "key-b", "auth": "auth-b"},
        }

        self.db.push_save_subscription(self.alice["id"], first)
        self.db.push_save_subscription(self.alice["id"], second)
        rows = self.db.push_list_subscriptions(self.alice["id"])

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["endpoint"], second["endpoint"])
        self.assertEqual(rows[0]["keys"]["p256dh"], "key-b")

    def test_push_list_conversation_recipient_subscriptions_excludes_sender(self):
        conv = self.db.dm_create_or_get_conversation(self.alice["id"], self.bob["email"])
        self.db.push_save_subscription(self.alice["id"], {
            "endpoint": "https://push.example/alice",
            "keys": {"p256dh": "alice-key", "auth": "alice-auth"},
        })
        self.db.push_save_subscription(self.bob["id"], {
            "endpoint": "https://push.example/bob",
            "keys": {"p256dh": "bob-key", "auth": "bob-auth"},
        })

        rows = self.db.push_list_conversation_recipients(conv["id"], self.alice["id"])

        self.assertEqual([r["user_id"] for r in rows], [self.bob["id"]])
        self.assertEqual(rows[0]["subscription"]["endpoint"], "https://push.example/bob")

    def test_push_subscription_validation_rejects_missing_keys(self):
        with self.assertRaises(ValueError):
            self.db.push_save_subscription(self.alice["id"], {"endpoint": "x", "keys": {}})


if __name__ == "__main__":
    unittest.main()
