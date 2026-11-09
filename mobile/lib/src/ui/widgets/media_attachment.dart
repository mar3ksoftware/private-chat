import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../net/media_client.dart';
import '../../net/media_opener.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';

/// Lazy attachment renderer inside a chat bubble: fetches and decrypts the
/// descriptor's file through the controller cache, then shows an inline
/// image or a card that opens videos in the OS player.
class MediaAttachment extends StatefulWidget {
  const MediaAttachment({
    super.key,
    required this.descriptor,
    required this.controller,
  });

  final MediaDescriptor descriptor;
  final ChatController controller;

  @override
  State<MediaAttachment> createState() => _MediaAttachmentState();
}

class _MediaAttachmentState extends State<MediaAttachment> {
  MediaFetchResult? _result;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await widget.controller.loadMedia(widget.descriptor);
    if (!mounted) return;
    setState(() => _result = result);
  }

  Future<void> _openVideo() async {
    final opened = await MediaOpener.open(
      bytes: _result?.bytes ?? Uint8List(0),
      mime: widget.descriptor.mime,
      name: widget.descriptor.name,
    );
    if (!opened) {
      widget.controller.showError('Could not open the video.');
    }
  }

  Widget _statusText(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontStyle: FontStyle.italic,
        height: 1.4,
        color: AppColors.textSecondary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    if (result == null) return _statusText('Loading…');
    if (result.status == 'expired') return _statusText('Attachment expired');
    if (result.status != 'ready' || result.bytes == null) {
      return _statusText('Attachment unavailable');
    }

    final bytes = result.bytes!;
    if (widget.descriptor.mime.startsWith('image/')) {
      return ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 260),
        child: Image.memory(bytes, fit: BoxFit.contain),
      );
    }

    return InkWell(
      onTap: _openVideo,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.fill,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.movie_outlined,
              size: 26,
              color: AppColors.textSecondary,
            ),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.descriptor.name ?? 'Video',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  const Text(
                    'Tap to open in player',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
