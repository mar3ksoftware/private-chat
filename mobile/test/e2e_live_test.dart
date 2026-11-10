// Full-stack E2E against a live backend: two real ChatController clients —
// guest join, roster visibility, public-key exchange, bidirectional
// encrypted private messages over real Socket.IO transport.
//
// Skipped unless RUN_LIVE_E2E=1 (requires backend on SERVER_URL):
//   RUN_LIVE_E2E=1 flutter test test/e2e_live_test.dart
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';

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

  test(
    'group membership management and vote-kick through live backend',
    () async {
      final suffix = DateTime.now().millisecondsSinceEpoch % 100000;
      final aName = 'alice_$suffix';
      final bName = 'bob_$suffix';
      final cName = 'charlie_$suffix';
      final dName = 'dave_$suffix';
      final groupName = 'Team_$suffix';

      final alice = ChatController.forServer(serverUrl: url);
      final bob = ChatController.forServer(serverUrl: url);
      final charlie = ChatController.forServer(serverUrl: url);
      final dave = ChatController.forServer(serverUrl: url);
      addTearDown(alice.dispose);
      addTearDown(bob.dispose);
      addTearDown(charlie.dispose);
      addTearDown(dave.dispose);

      alice.joinAsGuest(aName);
      bob.joinAsGuest(bName);
      charlie.joinAsGuest(cName);
      await _waitFor(
        () => alice.me != null && bob.me != null && charlie.me != null,
        'three clients joined',
      );

      // charlie drops offline before the group exists.
      charlie.logout();

      alice.createGroup(groupName, <String>[bName, cName]);
      await _waitFor(
        () => alice.groups.any((g) => g.name == groupName),
        'alice received the new group',
      );
      await _waitFor(
        () => bob.groups.any((g) => g.name == groupName),
        'bob received the new group',
      );

      // The offline invitee stayed a member and finds the group on rejoin.
      charlie.joinAsGuest(cName);
      await _waitFor(() => charlie.me != null, 'charlie rejoined');
      await _waitFor(
        () => charlie.groups.any((g) => g.name == groupName),
        'charlie sees the group after rejoin',
      );

      dave.joinAsGuest(dName);
      await _waitFor(() => dave.me != null, 'dave joined');
      final groupId = alice
          .groups
          .firstWhere((g) => g.name == groupName)
          .groupId;
      alice.addMember(groupId, dName);
      await _waitFor(
        () => alice.groups
            .any((g) => g.groupId == groupId && g.members.length == 4),
        'dave added to the group',
      );

      // Two votes pass only in a three-member group (required = 2), so
      // charlie's part of the demo ends with an admin remove.
      alice.removeMember(groupId, cName);
      await _waitFor(
        () => alice.groups
            .any((g) => g.groupId == groupId && g.members.length == 3),
        'charlie removed from the group',
      );

      alice.kickVote(groupId, bName);
      dave.kickVote(groupId, bName);
      await _waitFor(
        () =>
            !bob.groups.any((g) => g.groupId == groupId) &&
            (bob.error?.startsWith('You were voted out of') ?? false),
        'bob voted out with the toast',
      );
      expect(bob.error, 'You were voted out of $groupName.');

      await _waitFor(
        () => alice.groups
            .any((g) => g.groupId == groupId && g.members.length == 2),
        'alice sees the two remaining members',
      );
      await _waitFor(
        () => dave.groups
            .any((g) => g.groupId == groupId && g.members.length == 2),
        'dave sees the two remaining members',
      );
      final survivors = alice.groups
          .firstWhere((g) => g.groupId == groupId)
          .members
          .map((m) => m.username);
      expect(survivors, unorderedEquals(<String>[aName, dName]));

      // A fresh join snapshot must list every name that ever joined.
      bob.logout();
      bob.joinAsGuest(bName);
      await _waitFor(() => bob.me != null, 'bob rejoined');
      await _waitFor(
        () => <String>[aName, bName, cName, dName]
            .every(bob.directory.contains),
        'bob directory lists everyone',
      );
      expect(
        <String>[aName, bName, cName, dName].every(alice.directory.contains),
        isTrue,
      );
    },
    timeout: const Timeout(Duration(seconds: 90)),
    skip: !live,
  );

  test(
    'media attachment round trip through live backend',
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
            alice.e2ee.hasSharedKey(bName) && bob.e2ee.hasSharedKey(aName),
        'shared keys derived on both sides',
      );
      await _waitFor(() => alice.mediaToken != null, 'alice media token');
      await _waitFor(() => bob.mediaToken != null, 'bob media token');

      // Video mime skips the EXIF path, so no image fixture is needed here.
      final original = Uint8List.fromList(
        List<int>.generate(1024, (index) => index % 251),
      );
      expect(
        await alice.sendMediaMessage(
          bName,
          original,
          mime: 'video/mp4',
          name: 'clip.mp4',
        ),
        isTrue,
        reason: 'alice media send failed: ${alice.error}',
      );

      await _waitFor(
        () => bob.messagesForPeer(aName).any((message) => message.media != null),
        'bob received the media message',
      );
      final received = bob
          .messagesForPeer(aName)
          .lastWhere((message) => message.media != null);
      final descriptor = received.media!;
      expect(descriptor.mime, 'video/mp4');
      expect(descriptor.name, 'clip.mp4');
      expect(descriptor.size, original.length);

      final fetched = await bob.loadMedia(descriptor);
      expect(fetched.status, 'ready', reason: 'media fetch did not succeed');
      expect(fetched.bytes, orderedEquals(original));
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
