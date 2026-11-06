import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'src/net/socket_service.dart';
import 'src/state/chat_controller.dart';
import 'src/ui/root_screen.dart';
import 'src/ui/theme/app_theme.dart';
import 'src/ui/widgets/error_toaster.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Light system icons over the dark app surfaces.
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  runApp(const PrivateChatApp());
}

/// Root widget: owns (or reuses an injected) [ChatController] and provides
/// the dark theme. Widget tests inject a controller backed by a fake
/// [SocketService] so no real connection is opened.
class PrivateChatApp extends StatefulWidget {
  const PrivateChatApp({super.key, this.controller, this.serverUrl});

  /// Pre-built controller (tests). When null the app creates its own.
  final ChatController? controller;

  /// Backend URL used when the app creates its own controller.
  final String? serverUrl;

  @override
  State<PrivateChatApp> createState() => _PrivateChatAppState();
}

class _PrivateChatAppState extends State<PrivateChatApp> {
  late final ChatController _controller;
  late final bool _ownsController;

  @override
  void initState() {
    super.initState();
    final injected = widget.controller;
    if (injected != null) {
      _controller = injected;
      _ownsController = false;
    } else {
      _controller = ChatController.forServer(
        serverUrl: widget.serverUrl ?? SocketService.defaultUrl,
      );
      _ownsController = true;
    }
  }

  @override
  void dispose() {
    if (_ownsController) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Private Chat',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: ErrorToaster(
        controller: _controller,
        child: RootScreen(controller: _controller),
      ),
    );
  }
}
