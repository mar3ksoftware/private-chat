import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';
import 'media_attachment.dart';

/// One render-ready message, normalized from either wire model so the
/// bubble and list only deal with a single shape.
class MessageView {
  const MessageView({
    required this.text,
    required this.isOwn,
    required this.timestamp,
    this.sender,
    this.decryptionFailed = false,
    this.media,
  });

  factory MessageView.fromPrivate(DecryptedMessage message) {
    return MessageView(
      text: message.plaintext,
      isOwn: message.isOwn,
      timestamp: message.timestamp,
      decryptionFailed: message.decryptionFailed,
      media: message.media,
    );
  }

  factory MessageView.fromGroup(DecryptedGroupMessage message) {
    return MessageView(
      text: message.plaintext,
      isOwn: message.isOwn,
      timestamp: message.timestamp,
      sender: message.fromUsername,
      decryptionFailed: message.decryptionFailed,
      media: message.media,
    );
  }

  final String text;
  final bool isOwn;
  final int timestamp;

  /// Sender shown above peer bubbles in group chats.
  final String? sender;

  /// True while the plaintext is still ciphertext or failed to decrypt —
  /// the controller already fills [text] with `[Encrypted]` /
  /// `[Decryption failed]`.
  final bool decryptionFailed;

  /// Attachment descriptor for media messages, null for plain text.
  final MediaDescriptor? media;
}

/// Rounded chat bubble with a soft shadow: indigo for our own messages,
/// zinc for everyone else's.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.text,
    required this.isOwn,
    required this.timestamp,
    this.sender,
    this.decryptionFailed = false,
    this.media,
    this.controller,
  });

  factory MessageBubble.fromView(MessageView view, {ChatController? controller}) {
    return MessageBubble(
      text: view.text,
      isOwn: view.isOwn,
      timestamp: view.timestamp,
      sender: view.sender,
      decryptionFailed: view.decryptionFailed,
      media: view.media,
      controller: controller,
    );
  }

  final String text;
  final bool isOwn;
  final int timestamp;
  final String? sender;
  final bool decryptionFailed;
  final MediaDescriptor? media;
  final ChatController? controller;

  String get _time {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    final showSender = sender != null && !isOwn;
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = (constraints.maxWidth * 0.72).clamp(160.0, 340.0);
        return Column(
          crossAxisAlignment: isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (showSender)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 3),
                child: Text(
                  sender!,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textMuted,
                  ),
                ),
              ),
            Container(
              constraints: BoxConstraints(maxWidth: maxWidth),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(
                color: isOwn ? AppColors.accentDeep : AppColors.surfaceAlt,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isOwn ? 16 : 4),
                  bottomRight: Radius.circular(isOwn ? 4 : 16),
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x40000000),
                    offset: Offset(0, 2),
                    blurRadius: 6,
                  ),
                ],
              ),
              child: media != null && !decryptionFailed && controller != null
                  ? MediaAttachment(descriptor: media!, controller: controller!)
                  : decryptionFailed
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.lock_outline,
                          size: 13,
                          color: isOwn
                              ? const Color(0xB3FFFFFF)
                              : AppColors.textMuted,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            text,
                            style: TextStyle(
                              fontSize: 13,
                              fontStyle: FontStyle.italic,
                              height: 1.4,
                              color: isOwn
                                  ? const Color(0xB3FFFFFF)
                                  : AppColors.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    )
                  : Text(
                      text,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.4,
                        color: isOwn ? Colors.white : AppColors.textBody,
                      ),
                    ),
            ),
            const SizedBox(height: 3),
            Padding(
              padding: EdgeInsets.only(left: isOwn ? 0 : 4, right: isOwn ? 4 : 0),
              child: Text(
                _time,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w400,
                  color: AppColors.textMuted,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
