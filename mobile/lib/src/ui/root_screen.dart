import 'package:flutter/material.dart';

import '../state/chat_controller.dart';
import 'screens/auth_screen.dart';
import 'screens/chat_shell.dart';

/// Chooses between the auth screen and the chat shell based on the
/// authenticated identity, rebuilding whenever the controller notifies.
class RootScreen extends StatelessWidget {
  const RootScreen({super.key, required this.controller});

  final ChatController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        if (controller.me == null) {
          return AuthScreen(controller: controller);
        }
        return ChatShell(controller: controller);
      },
    );
  }
}
