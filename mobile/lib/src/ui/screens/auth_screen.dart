import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../net/server_config.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/connection_status.dart';
import '../widgets/glass_panel.dart';
import '../widgets/server_config_scope.dart';

/// Sign in / Register / Guest tabs inside one glass card, matching the web
/// `AuthScreen`.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.controller});

  final ChatController controller;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

enum _AuthTab { signIn, register, guest }

class _AuthScreenState extends State<AuthScreen> {
  _AuthTab _tab = _AuthTab.signIn;

  static const List<(_AuthTab, String)> _tabs = [
    (_AuthTab.signIn, 'Sign In'),
    (_AuthTab.register, 'Register'),
    (_AuthTab.guest, 'Guest'),
  ];

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.75),
            radius: 1.1,
            colors: [Color(0x266366F1), AppColors.background],
            stops: [0, 0.55],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    GlassPanel(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                      const Icon(
                        Icons.lock_outline,
                        size: 30,
                        color: AppColors.accentSoft,
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'Scattered Keyhole',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 25,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.5,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'End-to-end encrypted',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 22),
                      _buildTabBar(),
                      const SizedBox(height: 18),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 160),
                        switchInCurve: Curves.easeOut,
                        switchOutCurve: Curves.easeIn,
                        child: switch (_tab) {
                          _AuthTab.signIn => _SignInForm(
                              key: const ValueKey('sign-in'),
                              controller: controller,
                            ),
                          _AuthTab.register => _RegisterForm(
                              key: const ValueKey('register'),
                              controller: controller,
                            ),
                          _AuthTab.guest => _GuestForm(
                              key: const ValueKey('guest'),
                              controller: controller,
                            ),
                        },
                      ),
                      const SizedBox(height: 22),
                      const Divider(height: 1),
                      const SizedBox(height: 14),
                      ListenableBuilder(
                        listenable: controller,
                        builder: (context, _) => ConnectionBadge(
                          status: controller.connectionStatus,
                        ),
                      ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    const _ServerAddressTile(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.fill,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          for (final (tab, label) in _tabs)
            Expanded(
              child: _AuthTabButton(
                label: label,
                active: _tab == tab,
                onTap: () => setState(() => _tab = tab),
              ),
            ),
        ],
      ),
    );
  }
}

class _AuthTabButton extends StatelessWidget {
  const _AuthTabButton({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        constraints: const BoxConstraints(minHeight: 40),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? AppColors.accentDeep : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: active ? Colors.white : AppColors.textSecondary,
          ),
        ),
      ),
    );
  }
}

// ── Server address ───────────────────────────────────────────────────────

/// Compact outlined "Server" row under the auth card. Expands into a text
/// field prefilled with the address the current controller uses; saving a
/// valid one persists it and asks the app to recreate the controller.
///
/// Only reachable while logged out — changing servers mid-session is not
/// supported, so there is no live-migration logic here.
class _ServerAddressTile extends StatefulWidget {
  const _ServerAddressTile();

  @override
  State<_ServerAddressTile> createState() => _ServerAddressTileState();
}

class _ServerAddressTileState extends State<_ServerAddressTile> {
  final TextEditingController _url = TextEditingController();
  bool _expanded = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      _expanded = !_expanded;
      _error = null;
      if (_expanded) {
        // Always start from the address the app is actually using.
        _url.text = ServerConfigScope.of(context).url;
      }
    });
  }

  Future<void> _save() async {
    final raw = _url.text;
    final error = ServerConfig.validationError(raw);
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    final url = ServerConfig.normalize(raw);
    await ServerConfig.save(url);
    if (!mounted) return;
    // Hand off to the app: it swaps its controller for one pointing at
    // [url], then this row collapses and shows the new address.
    ServerConfigScope.of(context).onServerSaved(url);
    setState(() {
      _error = null;
      _expanded = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final currentUrl = ServerConfigScope.of(context).url;
    if (!_expanded) return _buildToggle(currentUrl);
    return _buildEditor();
  }

  Widget _buildToggle(String currentUrl) {
    return OutlinedButton(
      key: const Key('server-address-toggle'),
      onPressed: _toggle,
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.textSecondary,
        side: const BorderSide(color: AppColors.border),
        minimumSize: const Size.fromHeight(40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      child: Row(
        children: [
          const Icon(Icons.dns_outlined, size: 15, color: AppColors.textMuted),
          const SizedBox(width: 8),
          const Text('Server'),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              currentUrl,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w400,
                color: AppColors.textMuted,
              ),
            ),
          ),
          const SizedBox(width: 4),
          const Icon(
            Icons.expand_more,
            size: 18,
            color: AppColors.textMuted,
          ),
        ],
      ),
    );
  }

  Widget _buildEditor() {
    return Container(
      key: const Key('server-address-editor'),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: AppColors.fill,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Server address',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('server-address-input'),
            controller: _url,
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _save(),
            style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
            decoration: const InputDecoration(
              hintText: 'http://192.168.1.5:3000',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.dangerSoft,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextButton(
                  key: const Key('server-address-cancel'),
                  onPressed: _toggle,
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                key: const Key('server-address-save'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(96, 40),
                ),
                onPressed: _save,
                child: const Text('Save'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Shared form pieces ───────────────────────────────────────────────────

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.controller,
    this.labelSuffix,
    this.hint,
    this.obscure = false,
    this.keyboardType,
    this.autofillHints,
    this.formatters,
  });

  final String label;
  final String? labelSuffix;
  final TextEditingController controller;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final List<TextInputFormatter>? formatters;

  @override
  Widget build(BuildContext context) {
    final labelStyle = const TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w500,
      color: AppColors.textSecondary,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            text: label,
            style: labelStyle,
            children: [
              if (labelSuffix != null)
                TextSpan(
                  text: ' $labelSuffix',
                  style: const TextStyle(
                    fontWeight: FontWeight.w400,
                    color: AppColors.textMuted,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 7),
        TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          autofillHints: autofillHints,
          inputFormatters: formatters,
          style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
          decoration: InputDecoration(hintText: hint),
        ),
      ],
    );
  }
}

class _FormError extends StatelessWidget {
  const _FormError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Text(
        message,
        style: const TextStyle(fontSize: 13, color: AppColors.dangerSoft),
      ),
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const _SubmitButton({
    required this.label,
    required this.loading,
    required this.onPressed,
  });

  final String label;
  final bool loading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      width: double.infinity,
      child: ElevatedButton(
        onPressed: loading ? null : onPressed,
        child: loading
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(label),
                ],
              )
            : Text(label),
      ),
    );
  }
}

// ── Sign in ──────────────────────────────────────────────────────────────

class _SignInForm extends StatefulWidget {
  const _SignInForm({super.key, required this.controller});

  final ChatController controller;

  @override
  State<_SignInForm> createState() => _SignInFormState();
}

class _SignInFormState extends State<_SignInForm> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _pin = TextEditingController();
  String? _clientError;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _pin.dispose();
    super.dispose();
  }

  void _submit() {
    setState(() => _clientError = null);
    if (_username.text.trim().isEmpty) {
      setState(() => _clientError = 'Username is required');
      return;
    }
    if (_password.text.isEmpty) {
      setState(() => _clientError = 'Password is required');
      return;
    }
    widget.controller.login(
      _username.text.trim(),
      _password.text,
      pin: _pin.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Field(
              label: 'Username',
              controller: _username,
              hint: 'Enter username',
              autofillHints: const [AutofillHints.username],
              keyboardType: TextInputType.text,
            ),
            const SizedBox(height: 14),
            _Field(
              label: 'Password',
              controller: _password,
              hint: 'Enter password',
              obscure: true,
              autofillHints: const [AutofillHints.password],
            ),
            const SizedBox(height: 14),
            _Field(
              label: 'PIN',
              labelSuffix: '(optional, 4-6 digits)',
              controller: _pin,
              hint: 'Enter PIN',
              obscure: true,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              formatters: [LengthLimitingTextInputFormatter(6)],
            ),
            if (_clientError != null) _FormError(message: _clientError!),
            const SizedBox(height: 18),
            _SubmitButton(
              label: 'Sign In',
              loading: controller.isLoading,
              onPressed: _submit,
            ),
          ],
        );
      },
    );
  }
}

// ── Register ─────────────────────────────────────────────────────────────

class _RegisterForm extends StatefulWidget {
  const _RegisterForm({super.key, required this.controller});

  final ChatController controller;

  @override
  State<_RegisterForm> createState() => _RegisterFormState();
}

class _RegisterFormState extends State<_RegisterForm> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  final TextEditingController _pin = TextEditingController();
  String? _clientError;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _confirm.dispose();
    _pin.dispose();
    super.dispose();
  }

  void _submit() {
    setState(() => _clientError = null);
    if (_username.text.trim().isEmpty) {
      setState(() => _clientError = 'Username is required');
      return;
    }
    if (_password.text.length < 8) {
      setState(() => _clientError = 'Password must be at least 8 characters');
      return;
    }
    if (_password.text != _confirm.text) {
      setState(() => _clientError = 'Passwords do not match');
      return;
    }
    widget.controller.register(
      _username.text.trim(),
      _password.text,
      pin: _pin.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Field(
              label: 'Username',
              controller: _username,
              hint: 'Choose a username',
              autofillHints: const [AutofillHints.username],
            ),
            const SizedBox(height: 14),
            _Field(
              label: 'Password',
              controller: _password,
              hint: 'Min 8 characters',
              obscure: true,
              autofillHints: const [AutofillHints.newPassword],
            ),
            const SizedBox(height: 14),
            _Field(
              label: 'Confirm Password',
              controller: _confirm,
              hint: 'Repeat password',
              obscure: true,
              autofillHints: const [AutofillHints.newPassword],
            ),
            const SizedBox(height: 14),
            _Field(
              label: 'PIN',
              labelSuffix: '(optional, 4-6 digits)',
              controller: _pin,
              hint: 'Extra security layer',
              obscure: true,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              formatters: [LengthLimitingTextInputFormatter(6)],
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Optional — adds extra security',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ),
            if (_clientError != null) _FormError(message: _clientError!),
            const SizedBox(height: 18),
            _SubmitButton(
              label: 'Create Account',
              loading: controller.isLoading,
              onPressed: _submit,
            ),
          ],
        );
      },
    );
  }
}

// ── Guest ────────────────────────────────────────────────────────────────

class _GuestForm extends StatefulWidget {
  const _GuestForm({super.key, required this.controller});

  final ChatController controller;

  @override
  State<_GuestForm> createState() => _GuestFormState();
}

class _GuestFormState extends State<_GuestForm> {
  final TextEditingController _username = TextEditingController();
  String? _clientError;

  @override
  void dispose() {
    _username.dispose();
    super.dispose();
  }

  void _submit() {
    setState(() => _clientError = null);
    if (_username.text.trim().isEmpty) {
      setState(() => _clientError = 'Username is required');
      return;
    }
    widget.controller.joinAsGuest(_username.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Field(
              label: 'Username',
              controller: _username,
              hint: 'Pick a username',
              autofillHints: const [AutofillHints.username],
            ),
            const SizedBox(height: 10),
            const Text(
              'Guest sessions have no account. Your identity won’t persist.',
              style: TextStyle(fontSize: 12, height: 1.45, color: AppColors.textMuted),
            ),
            if (_clientError != null) _FormError(message: _clientError!),
            const SizedBox(height: 18),
            _SubmitButton(
              label: 'Join as Guest',
              loading: controller.isLoading,
              onPressed: _submit,
            ),
          ],
        );
      },
    );
  }
}
