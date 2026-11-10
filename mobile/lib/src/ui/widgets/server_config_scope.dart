import 'package:flutter/material.dart';

/// Carries the active server address and the "user saved a new one" callback
/// from `ScatteredKeyholeApp` down to the auth screen (which lives behind the
/// navigator, so the scope sits *above* `MaterialApp`).
///
/// The scope only exists while the app owns its controller; when a controller
/// is injected (tests) the auth screen still finds it and persists edits, but
/// the app ignores the callback.
class ServerConfigScope extends InheritedWidget {
  const ServerConfigScope({
    super.key,
    required this.url,
    required this.onServerSaved,
    required super.child,
  });

  /// Backend address the current controller was created with.
  final String url;

  /// Called with the validated, normalized URL the user just saved while
  /// logged out; the app rebuilds its [ChatController] against it.
  final ValueChanged<String> onServerSaved;

  static ServerConfigScope of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<ServerConfigScope>();
    assert(scope != null, 'No ServerConfigScope found above the context');
    return scope!;
  }

  @override
  bool updateShouldNotify(ServerConfigScope oldWidget) =>
      url != oldWidget.url || onServerSaved != oldWidget.onServerSaved;
}
