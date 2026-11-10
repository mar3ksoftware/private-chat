// Group members sheet: admin vs non-admin controls, the kick-tally section
// and the admin add-member search.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/ui/widgets/group_members_sheet.dart';

import 'ui_test_support.dart';

/// The sheet's add-member search field, excluding the composer behind it.
Finder _addMemberField() {
  return find.descendant(
    of: find.byType(GroupMembersSheet),
    matching: find.byType(TextField),
  );
}

void main() {
  late FakeSocketService fake;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
  });

  tearDown(() => controller.dispose());

  const adminTeam = GroupInfo(
    groupId: 'g-team',
    name: 'Team',
    members: <GroupMember>[
      GroupMember(userId: 'u-me', username: 'me', isAdmin: true),
      GroupMember(userId: 'u-alice', username: 'alice', isAdmin: false),
      GroupMember(userId: 'u-bob', username: 'bob', isAdmin: false),
    ],
    createdBy: 'u-me',
    createdAt: 1000,
  );

  const peerTeam = GroupInfo(
    groupId: 'g-team',
    name: 'Team',
    members: <GroupMember>[
      GroupMember(userId: 'u-alice', username: 'alice', isAdmin: true),
      GroupMember(userId: 'u-me', username: 'me', isAdmin: false),
      GroupMember(userId: 'u-bob', username: 'bob', isAdmin: false),
    ],
    createdBy: 'u-alice',
    createdAt: 1000,
  );

  /// Opens the group conversation and taps the header's Members button.
  Future<void> openMembers(WidgetTester tester, {required bool admin}) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, [meInfo, aliceInfo, bobInfo]);
    setGroups(fake, [admin ? adminTeam : peerTeam]);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Groups (1)'));
    await tester.pump();
    await tester.tap(find.text('Team'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Members'));
    await tester.pumpAndSettle();
  }

  testWidgets('admin sees rows, remove actions and the add-member search',
      (tester) async {
    await openMembers(tester, admin: true);
    fake.fire(
      ChatEvents.usersDirectory,
      <String>['me', 'alice', 'bob', 'carol'],
    );
    await tester.pumpAndSettle();

    expect(find.text('Members (3)'), findsOneWidget);
    expect(find.text('alice'), findsOneWidget);
    expect(find.text('bob'), findsOneWidget);
    expect(find.text('admin'), findsOneWidget);
    // Remove is offered for everyone but the creator (us) and ourselves.
    expect(find.byIcon(Icons.person_remove_outlined), findsNWidgets(2));
    expect(find.byIcon(Icons.how_to_vote), findsNWidgets(2));
    expect(_addMemberField(), findsOneWidget);
    expect(find.text('carol'), findsOneWidget);

    await tester.tap(find.text('carol'));
    await tester.pump();
    expect(
      fake.payloadsOf(ChatEvents.groupMemberAdd).single,
      const GroupTargetPayload(groupId: 'g-team', username: 'carol'),
    );

    // Once the directory holds only members there is nothing left to add.
    fake.fire(ChatEvents.usersDirectory, <String>['me', 'alice', 'bob']);
    await tester.pumpAndSettle();
    expect(find.text('No users to add'), findsOneWidget);
    expect(find.text('carol'), findsNothing);
  });

  testWidgets('a non-admin member gets no remove or add controls',
      (tester) async {
    await openMembers(tester, admin: false);
    fake.fire(
      ChatEvents.usersDirectory,
      <String>['me', 'alice', 'bob', 'carol'],
    );
    await tester.pumpAndSettle();

    expect(find.text('Members (3)'), findsOneWidget);
    expect(find.text('admin'), findsOneWidget);
    expect(find.byIcon(Icons.person_remove_outlined), findsNothing);
    expect(_addMemberField(), findsNothing);
    expect(find.text('ADD MEMBER'), findsNothing);
    expect(find.text('carol'), findsNothing);
    // Only bob is voteable: alice is the creator and me is ourselves.
    expect(find.byIcon(Icons.how_to_vote), findsOneWidget);
  });

  testWidgets('an active tally shows progress and hides per-member votes',
      (tester) async {
    await openMembers(tester, admin: true);

    fake.fire(
      ChatEvents.groupKickTally,
      const KickTally(
        groupId: 'g-team',
        username: 'bob',
        votes: <String>['alice'],
        required: 2,
        status: 'active',
        expiresAt: 1700000000000,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1/2'), findsOneWidget);
    expect(find.byIcon(Icons.how_to_vote), findsNothing);
    expect(find.widgetWithText(TextButton, 'Vote'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Vote'));
    await tester.pump();
    expect(
      fake.payloadsOf(ChatEvents.groupKickVote).single,
      const GroupTargetPayload(groupId: 'g-team', username: 'bob'),
    );

    // Our own landed vote turns the button into a disabled Voted state.
    fake.fire(
      ChatEvents.groupKickTally,
      const KickTally(
        groupId: 'g-team',
        username: 'bob',
        votes: <String>['alice', 'me'],
        required: 2,
        status: 'active',
        expiresAt: 1700000000000,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('2/2'), findsOneWidget);
    final voted = tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Voted'),
    );
    expect(voted.onPressed, isNull);
    expect(find.byIcon(Icons.how_to_vote), findsNothing);
  });
}
