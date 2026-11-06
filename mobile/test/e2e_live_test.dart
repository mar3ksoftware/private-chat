// Full-stack E2E against a live backend: two real ChatController clients —
// guest join, roster visibility, public-key exchange, bidirectional
// encrypted private messages over real Socket.IO transport.
//
// Skipped unless RUN_LIVE_E2E=1 (requires backend on SERVER_URL):
//   RUN_LIVE_E2E=1 flutter test test/e2e_live_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:private_chat_mobile/src/state/chat_controller.dart';

void main() {
  final live = Platform.environment['RUN_LIVE_E2E'] == '1';
  final url = Platform.environment['SERVER_URL'] ?? 'http://localhost:3000';

  test(
    'two clients exchange E2EE messages through live backend',
    () async {
      final suffix = DateTime.now().millisecondsSinceEpoch % 100000;
      final aName = 'alice_$suffix';
      final bName = 'bob_$suffix';
      final alice = ChatController.forServer(serverUrl: url);
      final bob = ChatController.forServer(serverUrl: url);
      addTearDown(alice.dispose);
      addTearDown(bob.dispose);

      alice.joinAsGuest(aName);
      bob.joinAsGuest(bName);

      await _waitFor(() => alice.me != null && bob.me != null, 'both joined');
      await _waitFor(
        () =>
            alice.users.any((u) => u.username == bName) &&
            bob.users.any((u) => u.username == aName),
        'both see each other in roster',
      );
      await _waitFor(
        () => alice.e2ee.hasSharedKey(bName) && bob.e2ee.hasSharedKey(aName),
        'shared keys derived on both sides',
      );

      expect(
        await alice.sendMessage(bName, 'hello from alice e2e'),
        isTrue,
        reason: 'alice send failed: ${alice.error}',
      );
      await _waitFor(
        () => bob.messagesForPeer(aName).isNotEmpty,
        'bob received message',
      );
      expect(bob.messagesForPeer(aName).last.plaintext, 'hello from alice e2e');

      expect(
        await bob.sendMessage(aName, 'reply from bob'),
        isTrue,
        reason: 'bob send failed: ${bob.error}',
      );
      await _waitFor(
        () => alice.messagesForPeer(bName).isNotEmpty,
        'alice received reply',
      );
      // alice already has her own outgoing message in this bucket — wait for
      // bob's inbound reply specifically.
      await _waitFor(
        () => alice
            .messagesForPeer(bName)
            .any((m) => !m.isOwn && m.plaintext == 'reply from bob'),
        'alice decrypted bob reply',
      );
      final reply = alice
          .messagesForPeer(bName)
          .lastWhere((m) => !m.isOwn);
      expect(reply.plaintext, 'reply from bob');
    },
    timeout: const Timeout(Duration(seconds: 30)),
    skip: !live,
  );
}

Future<void> _waitFor(bool Function() cond, String what) async {
  final deadline = DateTime.now().add(const Duration(seconds: 10));
  while (DateTime.now().isBefore(deadline)) {
    if (cond()) return;
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  fail('timeout waiting for: $what');
}
