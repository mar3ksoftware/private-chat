import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Single-line composer with a Send button, local send-error text and a
/// disconnected state — the native counterpart of the web `MessageInput`.
class MessageComposer extends StatefulWidget {
  const MessageComposer({
    super.key,
    required this.onSend,
    required this.enabled,
  });

  /// Attempts to send the trimmed text; returns false when it did not go out.
  final Future<bool> Function(String text) onSend;

  /// False while the socket is disconnected: input and button are disabled.
  final bool enabled;

  @override
  State<MessageComposer> createState() => _MessageComposerState();
}

class _MessageComposerState extends State<MessageComposer> {
  static const int _maxMessageLength = 5000;

  final TextEditingController _textController = TextEditingController();
  bool _sending = false;
  String? _localError;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }
 bool get _canSend =>
      widget.enabled &&
      !_sending &&
      _textController.text.trim().isNotEmpty;

  Future<void> _send() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _sending || !widget.enabled) return;
    setState(() {
      _sending = true;
      _localError = null;
    });
    var sent = false;
    try {
      sent = await widget.onSend(text);
    } catch (_) {
      sent = false;
    }
    if (!mounted) return;
    setState(() {
      _sending = false;
      if (sent) {
        _textController.clear();
        _localError = null;
      } else {
        _localError = 'Message not sent. Please try again.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_localError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
              child: Text(
                _localError!,
                style: const TextStyle(fontSize: 12, color: AppColors.dangerSoft),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: _textController,
                  enabled: widget.enabled,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _send(),
                  textInputAction: TextInputAction.send,
                  textCapitalization: TextCapitalization.sentences,
                  maxLength: _maxMessageLength,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    color: AppColors.textPrimary,
                  ),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: widget.enabled ? 'Type a message…' : 'Disconnected…',
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 13,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(
                        color: AppColors.accent,
                        width: 1.5,
                      ),
                    ),
                    disabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    filled: true,
                    fillColor: widget.enabled
                        ? AppColors.fill
                        : AppColors.fill.withValues(alpha: 0.4),
                    hintStyle: const TextStyle(
                      fontSize: 14,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _canSend ? _send : null,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(72, 48),
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: _sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Send'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
