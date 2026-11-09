// Media bubbles (expired / unavailable / inline image) and the composer's
// attach flow: the button runs onAttach, spins while it is pending and
// disables the input for the duration.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:private_chat_mobile/src/models/models.dart';
import 'package:private_chat_mobile/src/net/media_client.dart';
import 'package:private_chat_mobile/src/state/chat_controller.dart';
import 'package:private_chat_mobile/src/ui/theme/app_theme.dart';
import 'package:private_chat_mobile/src/ui/widgets/message_bubble.dart';
import 'package:private_chat_mobile/src/ui/widgets/message_composer.dart';

import 'ui_test_support.dart';

/// Controller stand-in that serves a fixed fetch result without touching
/// the network or the decrypt pipeline.
class StubMediaController extends ChatController {
  StubMediaController(this.stubbedResult)
    : super(
        socket: FakeSocketService(),
        errorClearDelay: const Duration(days: 1),
      );

  final MediaFetchResult stubbedResult;
  int loadCalls = 0;

  @override
  Future<MediaFetchResult> loadMedia(MediaDescriptor descriptor) async {
    loadCalls++;
    return stubbedResult;
  }
}

void main() {
  // 1×1 red RGBA PNG, the smallest valid image the decoder accepts.
  final Uint8List pngBytes = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  );

  MediaDescriptor imageDescriptor() => MediaDescriptor(
    fileId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    key: base64Encode(List<int>.filled(32, 1)),
    iv: base64Encode(List<int>.filled(12, 2)),
    sha256: base64Encode(List<int>.filled(32, 3)),
    mime: 'image/png',
    size: pngBytes.length,
    w: 1,
    h: 1,
    name: 'pixel.png',
  );

  Future<void> pumpAttachment(
    WidgetTester tester,
    StubMediaController controller,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(),
        home: Scaffold(
          body: ListView(
            children: [
              MessageBubble.fromView(
                MessageView(
                  text: '',
                  isOwn: false,
                  timestamp: DateTime(2026, 3, 5, 9, 30).millisecondsSinceEpoch,
                  media: imageDescriptor(),
                ),
                controller: controller,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  group('MediaAttachment', () {
    testWidgets('expired fetches render the contract status text', (tester) async {
      final controller = StubMediaController(const MediaFetchResult.expired());
      addTearDown(controller.dispose);

      await pumpAttachment(tester, controller);

      expect(controller.loadCalls, 1);
      expect(find.text('Attachment expired'), findsOneWidget);
      expect(find.text('Attachment unavailable'), findsNothing);
      expect(find.byType(Image), findsNothing);
    });

    testWidgets('failed fetches render the unavailable status text', (tester) async {
      final controller = StubMediaController(const MediaFetchResult.error());
      addTearDown(controller.dispose);

      await pumpAttachment(tester, controller);

      expect(find.text('Attachment unavailable'), findsOneWidget);
      expect(find.text('Attachment expired'), findsNothing);
      expect(find.byType(Image), findsNothing);
    });

    testWidgets('ready image bytes render an inline image', (tester) async {
      final controller = StubMediaController(MediaFetchResult.ready(pngBytes));
      addTearDown(controller.dispose);

      await pumpAttachment(tester, controller);

      expect(find.byType(Image), findsOneWidget);
      expect(find.text('Attachment expired'), findsNothing);
      expect(find.text('Attachment unavailable'), findsNothing);
      expect(find.text('Loading…'), findsNothing);
    });
  });

  group('MessageComposer attach', () {
    testWidgets('attach runs onAttach, spins, and disables the input', (tester) async {
      final pending = Completer<bool>();
      var invoked = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Scaffold(
            body: MessageComposer(
              enabled: true,
              onSend: (_) async => true,
              onAttach: () {
                invoked++;
                return pending.future;
              },
            ),
          ),
        ),
      );

      await tester.tap(find.byTooltip('Attach file'));
      await tester.pump();

      expect(invoked, 1);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);

      pending.complete(true);
      await tester.pumpAndSettle();

      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isTrue);
    });

    testWidgets('the attach button stays hidden without a handler', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Scaffold(
            body: MessageComposer(enabled: true, onSend: (_) async => true),
          ),
        ),
      );

      expect(find.byTooltip('Attach file'), findsNothing);
      expect(find.byIcon(Icons.attach_file_outlined), findsNothing);
    });
  });
}
