// Smoke test for the app entry point: the shell boots onto the auth screen
// with a controller backed by a fake socket (no real connection).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'ui_test_support.dart';

void main() {
  testWidgets('app opens on the auth screen', (WidgetTester tester) async {
    final fake = FakeSocketService();
    final controller = makeController(fake);
    addTearDown(controller.dispose);

    await pumpApp(tester, controller);

    expect(find.text('Private Chat'), findsWidgets);
    expect(find.text('End-to-end encrypted'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Sign In'), findsOneWidget);
    expect(find.text('Register'), findsOneWidget);
    expect(find.text('Guest'), findsOneWidget);
    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('Join as Guest'), findsNothing);
  });

  testWidgets('a signed-in user lands on the conversation list',
      (WidgetTester tester) async {
    final fake = FakeSocketService();
    final controller = makeController(fake);
    addTearDown(controller.dispose);
    signIn(fake);
    setUsers(fake, [aliceInfo, bobInfo]);

    await pumpApp(tester, controller);

    expect(find.text('ONLINE'), findsOneWidget);
    expect(find.text('alice'), findsOneWidget);
    expect(find.text('bob'), findsOneWidget);
    expect(find.text('Sign In'), findsNothing);
  });
}
