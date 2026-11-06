// Shell behavior: phone master-detail navigation (push + system back),
// selection clearing, the two-pane tablet layout, the create-group sheet
// and transient error snackbars.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:private_chat_mobile/src/models/models.dart';
import 'package:private_chat_mobile/src/net/chat_events.dart';
import 'package:private_chat_mobile/src/state/chat_controller.dart';
import 'package:private_chat_mobile/src/ui/screens/chat_shell.dart';

import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
  });

  tearDown(() => controller.dispose());

  /// Signs in and publishes a small roster with one group.
  void seed() {
    signIn(fake);
    setUsers(fake, [aliceInfo, bobInfo]);
    setGroups(fake, [groupInfo()]);
  }

  testWidgets('phone: tapping a user pushes the chat, system back returns',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    expect(find.text('ONLINE'), findsOneWidget);

    await tester.tap(find.text('alice'));
    await tester.pumpAndSettle();

    // Chat route on top of the list.
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    expect(find.text('Start of conversation'), findsOneWidget);
    expect(find.text('ONLINE'), findsNothing);
    expect(controller.selectedPeer, 'alice');
    expect(controller.selectedGroup, isNull);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.text('ONLINE'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back), findsNothing);
    // The selection survives the pop so the list can highlight it.
    expect(controller.selectedPeer, 'alice');
  });

  testWidgets('phone: back on the list clears the selection, then exits',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    await tester.tap(find.text('bob'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(controller.selectedPeer, 'bob');

    // First back press on the list clears the highlighted conversation…
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(controller.selectedPeer, isNull);
    expect(find.text('ONLINE'), findsOneWidget);

    // …the next one has nothing left to handle: default behavior (the
    // framework's route bubbling) and the list stays put in the test env.
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('ONLINE'), findsOneWidget);
  });

  testWidgets('wide: two-pane layout keeps list and chat side by side',
      (tester) async {
    useWideSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    // Idle state: sidebar plus empty detail pane.
    expect(find.text('ONLINE'), findsOneWidget);
    expect(find.text('Select a conversation'), findsOneWidget);

    await tester.tap(find.text('alice'));
    await tester.pumpAndSettle();

    // Both panes visible; the chat is not a route, so there is no back arrow.
    expect(find.text('ONLINE'), findsOneWidget);
    expect(find.text('Start of conversation'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back), findsNothing);

    // Back clears the selection and restores the empty pane.
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(controller.selectedPeer, isNull);
    expect(find.text('Select a conversation'), findsOneWidget);
    expect(find.text('ONLINE'), findsOneWidget);
  });

  testWidgets('wide: group selection opens the group conversation',
      (tester) async {
    useWideSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Groups (1)'));
    await tester.pump();
    await tester.tap(find.text('Team'));
    await tester.pumpAndSettle();

    expect(controller.selectedGroup, 'g-team');
    expect(controller.selectedPeer, isNull);
    // Once in the list row, once as the chat title.
    expect(find.text('Team'), findsNWidgets(2));
    expect(find.text('Group'), findsOneWidget);
    expect(find.text('3 members'), findsOneWidget);
  });

  testWidgets('create group sheet emits group:create and shows the group',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Groups (1)'));
    await tester.pump();
    await tester.tap(find.text('Create Group'));
    await tester.pumpAndSettle();

    expect(find.text('MEMBERS'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Team');
    await tester.tap(find.byType(Checkbox).first);
    await tester.tap(find.byType(Checkbox).last);
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Create'));
    await tester.pumpAndSettle();

    final payload =
        fake.payloadsOf(ChatEvents.groupCreate).single as GroupCreatePayload;
    expect(payload.name, 'Team');
    expect(payload.members, unorderedEquals(<String>['alice', 'bob']));

    // The backend confirms; the row appears in the list.
    setGroups(fake, [groupInfo()]);
    await tester.pumpAndSettle();
    expect(find.text('Team'), findsOneWidget);
    expect(find.text('3 members'), findsOneWidget);
  });

  testWidgets('server errors surface as a snackbar and clear themselves',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    fake.fire(ChatEvents.error, const ErrorPayload(message: 'username taken'));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.text('That username is already taken.'), findsOneWidget);
    expect(controller.error, isNull);

    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('lost connection shows the banner in the list', (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    fake.fire(ChatEvents.disconnect);
    await tester.pump();
    expect(find.text('Disconnected'), findsWidgets);
    expect(find.text('Connecting…'), findsNothing);

    fake.fire(ChatEvents.reconnectAttempt);
    await tester.pump();
    expect(find.text('Connecting…'), findsWidgets);
  });

  testWidgets('logout from the chat header returns to the auth screen',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    await tester.tap(find.text('alice'));
    await tester.pumpAndSettle();
    expect(find.text('Start of conversation'), findsOneWidget);

    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();

    expect(controller.me, isNull);
    expect(find.text('End-to-end encrypted'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Sign In'), findsOneWidget);
  });

  testWidgets('wide layout breakpoint is respected', (tester) async {
    // Just under the breakpoint: single pane.
    tester.view.physicalSize = const Size(699 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
    await pumpApp(tester, controller);
    seed();
    await tester.pumpAndSettle();

    expect(find.text('Select a conversation'), findsNothing);
    expect(kWideLayoutBreakpoint, 700);
    expect(find.text('ONLINE'), findsOneWidget);

    await tester.tap(find.text('alice'));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
  });
}
