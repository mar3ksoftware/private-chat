// Auth screen: tab switching, client-side validation, the guest join flow
// and transient error snackbars.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:private_chat_mobile/src/models/models.dart';
import 'package:private_chat_mobile/src/net/chat_events.dart';
import 'package:private_chat_mobile/src/state/chat_controller.dart';

import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
  });

  tearDown(() => controller.dispose());

  testWidgets('tabs switch between sign in, register and guest forms',
      (tester) async {
    await pumpApp(tester, controller);

    expect(find.widgetWithText(ElevatedButton, 'Sign In'), findsOneWidget);

    await tester.tap(find.text('Register'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(ElevatedButton, 'Create Account'), findsOneWidget);
    expect(find.text('Confirm Password'), findsOneWidget);

    await tester.tap(find.text('Guest'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(ElevatedButton, 'Join as Guest'), findsOneWidget);
    expect(
      find.text('Guest sessions have no account. Your identity won’t persist.'),
      findsOneWidget,
    );
  });

  testWidgets('guest form validates the username before joining',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    await tester.tap(find.text('Guest'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(ElevatedButton, 'Join as Guest'));
    await tester.pump();
    expect(find.text('Username is required'), findsOneWidget);
    expect(fake.payloadsOf(ChatEvents.userJoin), isEmpty);

    await tester.enterText(find.byType(TextField).first, '  nova  ');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Join as Guest'));
    await tester.pump();

    // Trimmed before it goes out on the wire.
    final payload = fake.payloadsOf(ChatEvents.userJoin).single as UserJoinPayload;
    expect(payload.username, 'nova');
    expect(controller.isLoading, isTrue);

    // Server acknowledges the join: the app swaps to the conversation list.
    fake.fire(ChatEvents.userJoined, novaInfo);
    setUsers(fake, [aliceInfo, novaInfo]);
    await tester.pumpAndSettle();

    expect(controller.me?.username, 'nova');
    expect(find.text('ONLINE'), findsOneWidget);
    expect(find.text('alice'), findsOneWidget);
    expect(find.text('Sign In'), findsNothing);
  });

  testWidgets('sign in sends credentials and renders the failure as a snackbar',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);

    await tester.enterText(find.byType(TextField).at(0), 'alice');
    await tester.enterText(find.byType(TextField).at(1), 'hunter22');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Sign In'));
    await tester.pump();

    final payload = fake.payloadsOf(ChatEvents.userLogin).single as LoginPayload;
    expect(payload.username, 'alice');
    expect(payload.password, 'hunter22');
    expect(payload.pin, isNull);

    fake.fire(
      ChatEvents.loginError,
      const AuthFailure(
        kind: 'login_error',
        reason: 'invalid_credentials',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.text('Incorrect username or password.'), findsOneWidget);
    // The toaster clears the transient error after showing it.
    expect(controller.error, isNull);

    // The snackbar dismisses itself; the form stays usable.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
    expect(find.widgetWithText(ElevatedButton, 'Sign In'), findsOneWidget);
  });

  testWidgets('register validates password length and confirmation',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    await tester.tap(find.text('Register'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'carol');
    await tester.enterText(find.byType(TextField).at(1), 'short');
    await tester.enterText(find.byType(TextField).at(2), 'short');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Create Account'));
    await tester.pump();
    expect(find.text('Password must be at least 8 characters'), findsOneWidget);

    await tester.enterText(find.byType(TextField).at(1), 'longenough');
    await tester.enterText(find.byType(TextField).at(2), 'different1');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Create Account'));
    await tester.pump();
    expect(find.text('Passwords do not match'), findsOneWidget);
    expect(fake.payloadsOf(ChatEvents.userRegister), isEmpty);

    await tester.enterText(find.byType(TextField).at(2), 'longenough');
    await tester.enterText(find.byType(TextField).at(3), '1234');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Create Account'));
    await tester.pump();

    final payload =
        fake.payloadsOf(ChatEvents.userRegister).single as RegisterPayload;
    expect(payload.username, 'carol');
    expect(payload.pin, '1234');
  });

  testWidgets('connection badge reflects the socket state', (tester) async {
    await pumpApp(tester, controller);
    expect(find.text('Connected'), findsOneWidget);

    fake.fire(ChatEvents.disconnect);
    await tester.pump();
    expect(find.text('Disconnected'), findsWidgets);

    fake.fire(ChatEvents.reconnectAttempt);
    await tester.pump();
    expect(find.text('Connecting…'), findsWidgets);

    fake.fire(ChatEvents.connect);
    await tester.pump();
    expect(find.text('Connected'), findsWidgets);
  });
}
