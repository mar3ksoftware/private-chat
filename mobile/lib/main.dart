import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'src/net/server_config.dart';
import 'src/net/socket_service.dart';
import 'src/state/chat_controller.dart';
import 'src/ui/root_screen.dart';
import 'src/ui/theme/app_theme.dart';
import 'src/ui/widgets/error_toaster.dart';
import 'src/ui/widgets/server_config_scope.dart';

/// Builds the [ChatController] the app owns for a backend [serverUrl].
/// Tests inject a fake-backed factory so no real connection is opened.
typedef ControllerFactory = ChatController Function(String serverUrl);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Light system icons over the dark app surfaces.
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  // The persisted server address is resolved inside `ScatteredKeyholeApp`, which
  // shows a minimal splash until it is known — the first frame paints right
  // away instead of blocking on the preference read.
  runApp(const ScatteredKeyholeApp());
}

/// Root widget: owns (or reuses an injected) [ChatController] and provides
/// the dark theme. Widget tests inject a controller backed by a fake
/// [SocketService] so no real connection is opened.
class ScatteredKeyholeApp extends StatefulWidget {
  const ScatteredKeyholeApp({
    super.key,
    this.controller,
    this.serverUrl,
    this.controllerFactory,
  });

  /// Pre-built controller (tests). When null the app creates its own.
  final ChatController? controller;

  /// Backend URL used when the app creates its own controller. When null
  /// the persisted address is loaded first and the splash is shown until
  /// it resolves.
  final String? serverUrl;

  /// Overrides how controllers are built (tests); defaults to
  /// [ChatController.forServer].
  final ControllerFactory? controllerFactory;

  @override
  State<ScatteredKeyholeApp> createState() => _ScatteredKeyholeAppState();
}

class _ScatteredKeyholeAppState extends State<ScatteredKeyholeApp> {
  /// The controller in use, or null while the persisted address is still
  /// loading (the splash frame).
  ChatController? _controller;

  late final bool _ownsController;

  /// Address [_controller] was built for; null during the splash.
  String? _serverUrl;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    final injected = widget.controller;
    if (injected != null) {
      _controller = injected;
      _serverUrl = widget.serverUrl ?? SocketService.defaultUrl;
    } else {
      final url = widget.serverUrl;
      if (url != null) {
        _adoptServer(url);
      } else {
        // Unknown until the preference read finishes: no controller exists
        // yet, so the very first connection already targets the saved host.
        _loadServerUrl();
      }
    }
  }

  @override
  void dispose() {
    if (_ownsController) _controller?.dispose();
    super.dispose();
  }

  Future<void> _loadServerUrl() async {
    final url = await ServerConfig.load();
    if (!mounted) return;
    setState(() => _adoptServer(url));
  }

  void _adoptServer(String serverUrl) {
    _serverUrl = serverUrl;
    _controller = _createController(serverUrl);
  }

  ChatController _createController(String serverUrl) {
    final factory = widget.controllerFactory;
    return factory != null
        ? factory(serverUrl)
        : ChatController.forServer(serverUrl: serverUrl);
  }

  /// Rebuilds the controller against [serverUrl] after the auth screen
  /// saved a new address. The setting only exists while logged out, so
  /// there is no session to migrate — the next join simply uses the new
  /// host.
  void _handleServerSaved(String serverUrl) {
    final old = _controller;
    if (!_ownsController || old == null || old.me != null) return;
    if (serverUrl == _serverUrl) return; // Same address: nothing to swap.
    setState(() => _adoptServer(serverUrl));
    // Dispose after the rebuild so the listeners above (ErrorToaster,
    // ListenableBuilder) detach from the old controller first;
    // ChangeNotifier only permits removeListener on a disposed instance.
    WidgetsBinding.instance.addPostFrameCallback((_) => old.dispose());
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return ServerConfigScope(
      // While the splash is up no auth UI exists, so the placeholder value
      // is never surfaced; every real screen is built after the load.
      url: _serverUrl ?? SocketService.defaultUrl,
      onServerSaved: _handleServerSaved,
      child: MaterialApp(
        title: 'Scattered Keyhole',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        home: controller == null
            ? const _StartupSplash()
            // Keyed by controller identity so the toaster re-subscribes when
            // a server address change swaps the controller underneath it.
            : ErrorToaster(
                key: ValueKey(controller),
                controller: controller,
                child: RootScreen(controller: controller),
              ),
      ),
    );
  }
}

/// Minimal dark frame shown while the persisted server address loads.
class _StartupSplash extends StatelessWidget {
  const _StartupSplash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: SizedBox(
          width: 26,
          height: 26,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            color: AppColors.accentSoft,
          ),
        ),
      ),
    );
  }
}
