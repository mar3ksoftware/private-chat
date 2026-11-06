import 'package:flutter/material.dart';

import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';

/// Watches [ChatController.error] and surfaces each new error as a floating
/// snackbar, then clears it through [ChatController.clearError].
///
/// Sits directly under `MaterialApp` so the snackbar renders above every
/// route, including pushed chat screens.
class ErrorToaster extends StatefulWidget {
  const ErrorToaster({super.key, required this.controller, required this.child});

  final ChatController controller;
  final Widget child;

  @override
  State<ErrorToaster> createState() => _ErrorToasterState();
}

class _ErrorToasterState extends State<ErrorToaster> {
  String? _lastShown;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_handleErrorChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_handleErrorChanged);
    super.dispose();
  }

  void _handleErrorChanged() {
    final error = widget.controller.error;
    if (error == null) {
      _lastShown = null;
      return;
    }
    if (error == _lastShown) return;
    _lastShown = error;

    // Show after the current frame so we never call ScaffoldMessenger while
    // the tree is mid-build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 4),
          margin: const EdgeInsets.fromLTRB(12, 0, 12, 16),
          content: Row(
            children: [
              const Icon(
                Icons.error_outline,
                size: 18,
                color: AppColors.dangerSoft,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(error, style: const TextStyle(fontSize: 13)),
              ),
            ],
          ),
        ),
      );
      widget.controller.clearError();
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
