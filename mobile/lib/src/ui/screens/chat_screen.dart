import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../crypto/media_crypto.dart';
import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../../utils/envelope.dart';
import '../theme/app_theme.dart';
import '../widgets/connection_status.dart';
import '../widgets/group_members_sheet.dart';
import '../widgets/message_bubble.dart';
import '../widgets/message_composer.dart';
import '../widgets/message_list.dart';

/// The conversation detail: header, message history, typing line and composer.
///
/// Rendered as the right pane in the two-pane layout (`showBack: false`)
/// and as a pushed full-screen route on phones (`showBack: true`).
class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.controller,
    this.peerUsername,
    this.groupId,
    this.showBack = false,
  }) : assert(peerUsername != null || groupId != null);

  final ChatController controller;
  final String? peerUsername;
  final String? groupId;
  final bool showBack;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  /// Message the composer will reply to (C4); cleared on send/switch.
  MessageView? _reply;

  /// Message being edited inline (C6); the composer prefills from its body.
  MessageView? _editing;

  ChatController get _controller => widget.controller;
  String? get _peer => widget.peerUsername;
  String? get _groupId => widget.groupId;

  ConversationTarget? get _target {
    final peer = _peer;
    if (peer != null) return ConversationTarget.dm(peer);
    final id = _groupId;
    if (id != null) return ConversationTarget.group(id);
    return null;
  }

  @override
  void didUpdateWidget(ChatScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final switched = oldWidget.peerUsername != widget.peerUsername ||
        oldWidget.groupId != widget.groupId;
    if (switched) {
      // Conversation switched: pending reply/edit and the typing burst end (C1).
      _reply = null;
      _editing = null;
      _controller.stopTyping();
    }
  }

  GroupInfo? _findGroup() {
    final id = _groupId;
    if (id == null) return null;
    for (final group in _controller.groups) {
      if (group.groupId == id) return group;
    }
    return null;
  }

  List<MessageView> _messages() {
    final peer = _peer;
    if (peer != null) {
      return [
        for (final message in _controller.messagesForPeer(peer))
          MessageView.fromPrivate(message),
      ];
    }
    final id = _groupId;
    if (id != null) {
      return [
        for (final message in _controller.groupMessagesFor(id))
          MessageView.fromGroup(message),
      ];
    }
    return const <MessageView>[];
  }

  /// Wire reply ref for [view] (C4): id + author username + ≤140-char excerpt.
  Map<String, dynamic>? _replyRefFor(MessageView view) {
    final id = view.id;
    if (id == null) return null;
    return buildReplyRef(
      id: id,
      username: view.author ?? '',
      excerpt: replyExcerptFor(
        view.body ?? view.text,
        mediaName: view.media?.name,
      ),
    );
  }

  Future<bool> _send(String text) async {
    final editing = _editing;
    if (editing != null) {
      final target = _target;
      final id = editing.id;
      if (target == null || id == null) return false;
      final sent = await _controller.editMessage(
        target,
        id,
        text,
        reply: editing.reply,
      );
      if (sent && mounted) {
        setState(() => _editing = null);
      }
      return sent;
    }

    final target = _target;
    if (target == null) return false;
    final replyRef = _reply != null ? _replyRefFor(_reply!) : null;
    final sent = target.isGroup
        ? await _controller.sendGroupMessage(
            _groupId!,
            text,
            reply: replyRef,
          )
        : await _controller.sendMessage(_peer!, text, reply: replyRef);
    if (sent && _reply != null && mounted) {
      setState(() => _reply = null);
    }
    return sent;
  }

  void _startReply(MessageView view) {
    if (view.id == null || view.deleted) return;
    setState(() {
      _reply = view;
      _editing = null;
    });
  }

  void _startEdit(MessageView view) {
    if (view.id == null || view.deleted || view.media != null) return;
    setState(() {
      _editing = view;
      _reply = null;
    });
  }

  /// Picks an attachment and hands it to the active conversation; a cancelled
  /// picker returns true (nothing to do, no error to show).
  Future<bool> _attach() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const <String>[
        'jpg',
        'jpeg',
        'png',
        'webp',
        'mp4',
        'webm',
        'mov',
      ],
      withData: true,
    );
    if (picked == null || picked.files.isEmpty) return true;
    final file = picked.files.first;
    final bytes = file.bytes;
    if (bytes == null) return false;

    final mime = mimeForFileName(file.name) ?? '';
    final peer = _peer;
    if (peer != null) {
      return _controller.sendMediaMessage(
        peer,
        bytes,
        mime: mime,
        name: file.name,
      );
    }
    final id = _groupId;
    if (id != null) {
      return _controller.sendGroupMediaMessage(
        id,
        bytes,
        mime: mime,
        name: file.name,
      );
    }
    return false;
  }

  /// `{displayName} is typing…` label for the open conversation, or null
  /// when nobody else is typing (C1; names in roster order, comma-joined).
  String? _typingLabel() {
    final peer = _peer;
    final groupId = _groupId;
    final names = peer != null
        ? _controller.typingUsernamesIn(peer: peer)
        : groupId != null
        ? _controller.typingUsernamesIn(groupId: groupId)
        : const <String>[];
    if (names.isEmpty) return null;
    final displayNames = [
      for (final name in names) _controller.displayNameOf(name),
    ];
    return '${displayNames.join(', ')} is typing…';
  }

  void _handleTyping() {
    final target = _target;
    if (target != null) _controller.sendTyping(target);
  }

  /// Group member usernames for the `@` autocomplete; DMs get null (C8).
  List<String>? _mentionCandidates() {
    final group = _findGroup();
    if (group == null) return null;
    return [for (final member in group.members) member.username];
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (context, _) {
        final group = _findGroup();
        final peer = _peer;
        final status =
            peer != null ? _controller.statusOf(peer) : '';
        final title =
            group?.name ??
            (peer != null ? _controller.displayNameOf(peer) : 'Direct');
        final typingLabel = _typingLabel();
        final reply = _reply;
        final editing = _editing;
        final target = _target;
        return SafeArea(
          child: Column(
            children: [
              _ChatHeader(
                title: title,
                subtitle: group != null
                    ? 'Group'
                    : (status.isEmpty ? null : status),
                status: _controller.connectionStatus,
                showBack: widget.showBack,
                showStatusLabel: !widget.showBack,
                onMembers: group == null
                    ? null
                    : () => showGroupMembersSheet(
                        context,
                        controller: _controller,
                        groupId: group.groupId,
                      ),
                onLogout: () {
                  _controller.logout();
                  // On phones the chat sits on top of the list; drop it so
                  // the auth screen underneath is visible right away.
                  if (widget.showBack && Navigator.canPop(context)) {
                    Navigator.pop(context);
                  }
                },
              ),
              Expanded(
                child: MessageList(
                  messages: _messages(),
                  controller: _controller,
                  target: target,
                  showReadTicks: peer != null,
                  readUpTo:
                      peer != null ? _controller.readUpToFor(peer) : 0,
                  onReply: _startReply,
                  onEdit: _startEdit,
                ),
              ),
              if (typingLabel != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                    child: Text(
                      key: const Key('typing-line'),
                      typingLabel,
                      style: const TextStyle(
                        fontSize: 12,
                        fontStyle: FontStyle.italic,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ),
              MessageComposer(
                enabled:
                    _controller.connectionStatus == ConnectionStatus.connected,
                onSend: _send,
                onAttach: _attach,
                replyAuthor: reply == null
                    ? null
                    : _controller.displayNameOf(reply.author ?? ''),
                replyExcerpt: reply == null
                    ? null
                    : replyExcerptFor(
                        reply.body ?? reply.text,
                        mediaName: reply.media?.name,
                      ),
                onCancelReply: () => setState(() => _reply = null),
                editingBody: editing?.body ?? editing?.text,
                onCancelEdit: () => setState(() => _editing = null),
                onTyping: _handleTyping,
                onStopTyping: _controller.stopTyping,
                mentionCandidates: _mentionCandidates(),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ChatHeader extends StatelessWidget {
  const _ChatHeader({
    required this.title,
    required this.status,
    required this.showBack,
    required this.showStatusLabel,
    required this.onLogout,
    this.subtitle,
    this.onMembers,
  });

  final String title;
  final String? subtitle;
  final ConnectionStatus status;
  final bool showBack;
  final bool showStatusLabel;
  final VoidCallback onLogout;
  final VoidCallback? onMembers;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.surfaceGlass,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(showBack ? 4 : 16, 6, 8, 6),
        child: Row(
          children: [
            if (showBack)
              IconButton(
                tooltip: 'Back to conversations',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(
                  Icons.arrow_back,
                  size: 22,
                  color: AppColors.textSecondary,
                ),
              ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    key: const Key('chat-header-title'),
                    title,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.1,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      key: const Key('chat-header-subtitle'),
                      subtitle!,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 0.3,
                        color: AppColors.textMuted,
                      ),
                    ),
                ],
              ),
            ),
            if (onMembers != null)
              IconButton(
                tooltip: 'Members',
                onPressed: onMembers,
                icon: const Icon(
                  Icons.people_outline,
                  size: 22,
                  color: AppColors.textSecondary,
                ),
              ),
            ConnectionBadge(status: status, showLabel: showStatusLabel),
            TextButton(onPressed: onLogout, child: const Text('Logout')),
          ],
        ),
      ),
    );
  }
}
