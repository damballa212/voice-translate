import importlib
import os
import tempfile
import unittest


class DmDbTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_PATH"] = os.path.join(self.tmp.name, "test.db")
        import db

        self.db = importlib.reload(db)
        self.alice = self.db.create_user("alice@example.com", "secret1", "Alice")
        self.bob = self.db.create_user("bob@example.com", "secret1", "Bob")
        self.carla = self.db.create_user("carla@example.com", "secret1", "Carla")

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_or_get_dm_conversation_reuses_existing_pair(self):
        first = self.db.dm_create_or_get_conversation(self.alice["id"], self.bob["email"])
        second = self.db.dm_create_or_get_conversation(self.bob["id"], self.alice["email"])

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["participant"]["email"], self.bob["email"])
        self.assertEqual(second["participant"]["email"], self.alice["email"])

    def test_create_dm_conversation_rejects_self_and_unknown_email(self):
        with self.assertRaises(ValueError):
            self.db.dm_create_or_get_conversation(self.alice["id"], self.alice["email"])

        with self.assertRaises(LookupError):
            self.db.dm_create_or_get_conversation(self.alice["id"], "missing@example.com")

    def test_dm_text_message_persists_and_lists_for_both_members(self):
        conv = self.db.dm_create_or_get_conversation(self.alice["id"], self.bob["email"])
        message = self.db.dm_add_text_message(conv["id"], self.alice["id"], " Hola Bob ")

        self.assertEqual(message["body"], "Hola Bob")
        alice_messages = self.db.dm_list_messages(conv["id"], self.alice["id"])
        bob_messages = self.db.dm_list_messages(conv["id"], self.bob["id"])

        self.assertEqual([m["id"] for m in alice_messages], [message["id"]])
        self.assertEqual([m["id"] for m in bob_messages], [message["id"]])

    def test_dm_messages_are_blocked_for_non_members(self):
        conv = self.db.dm_create_or_get_conversation(self.alice["id"], self.bob["email"])

        with self.assertRaises(PermissionError):
            self.db.dm_list_messages(conv["id"], self.carla["id"])

        with self.assertRaises(PermissionError):
            self.db.dm_add_text_message(conv["id"], self.carla["id"], "nope")

    def test_dm_conversation_list_includes_last_message_and_unread_count(self):
        conv = self.db.dm_create_or_get_conversation(self.alice["id"], self.bob["email"])
        first = self.db.dm_add_text_message(conv["id"], self.alice["id"], "one")
        self.db.dm_add_text_message(conv["id"], self.bob["id"], "two")

        self.db.dm_mark_read(conv["id"], self.alice["id"], first["id"])
        rows = self.db.dm_list_conversations(self.alice["id"])

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["participant"]["email"], self.bob["email"])
        self.assertEqual(rows[0]["last_message"]["body"], "two")
        self.assertEqual(rows[0]["unread_count"], 1)


if __name__ == "__main__":
    unittest.main()
