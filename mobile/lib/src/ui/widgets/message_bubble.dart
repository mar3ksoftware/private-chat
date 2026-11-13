import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../../utils/mentions.dart';
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
    this.author,
    this.decryptionFailed = false,
    this.media,
    this.id,
    this.body,
    this.reply,
    this.edited = false,
    this.deleted = false,
  });

  factory MessageView.fromPrivate(DecryptedMessage message) {
    return MessageView(
      text: message.plaintext,
      isOwn: message.isOwn,
      timestamp: message.timestamp,
      author: message.fromUsername,
      decryptionFailed: message.decryptionFailed,
      media: message.media,
      id: message.id,
      body: message.body,
      reply: message.reply,
      edited: message.edited,
      deleted: message.deleted,
    );
  }

  factory MessageView.fromGroup(DecryptedGroupMessage message) {
    return MessageView(
      text: message.plaintext,
      isOwn: message.isOwn,
      timestamp: message.timestamp,
      sender: message.fromUsername,
      author: message.fromUsername,
      decryptionFailed: message.decryptionFailed,
      media: message.media,
      id: message.id,
      body: message.body,
      reply: message.reply,
      edited: message.edited,
      deleted: message.deleted,
    );
  }

  /// Raw decrypted payload — the `[Encrypted]` / `[Decryption failed]`
  /// placeholder or the legacy plaintext when the envelope did not parse.
  final String text;

  final bool isOwn;
  final int timestamp;

  /// Sender shown above peer bubbles in group chats.
  final String? sender;

  /// Author username of the message (both directions) — used for reply refs.
  final String? author;

  /// True while the plaintext is still ciphertext or failed to decrypt —
  /// the controller already fills [text] with `[Encrypted]` /
  /// `[Decryption failed]`.
  final bool decryptionFailed;

  /// Attachment descriptor for media messages, null for plain text.
  final MediaDescriptor? media;

  /// Wire id (sender-generated UUID); null for locally constructed views.
  final String? id;

  /// Envelope-unwrapped body; falls back to [text] when null.
  final String? body;

  /// Reply ref `{id, u, e}` carried by the envelope (C4).
  final Map<String, dynamic>? reply;

  /// True once an edit was applied (C6) — renders ` (edited)` after the time.
  final bool edited;

  /// Tombstoned message (C6) — renders `This message was deleted`.
  final bool deleted;

  /// Body as rendered: the envelope body when known, the raw payload else.
  String get displayText => body ?? text;
}

/// Read-receipt tick state for own DM bubbles (C2).
enum MessageReadState {
  /// Not a tick-bearing bubble (group messages, peer messages).
  none,

  /// Single muted check — sent, no receipt yet.
  sent,

  /// Double check in accent color — a receipt covers this timestamp.
  read,
}

/// Rounded chat bubble with a soft shadow: indigo for our own messages,
/// zinc for everyone else's. Long-press opens the Reply/React/Edit/Delete
/// menu (C4–C6); reaction pills and read ticks render below the content.
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
    this.id,
    this.author,
    this.body,
    this.reply,
    this.edited = false,
    this.deleted = false,
    this.reactions,
    this.readState = MessageReadState.none,
    this.segments,
    this.target,
    this.onReply,
    this.onEdit,
  });

  factory MessageBubble.fromView(
    MessageView view, {
    ChatController? controller,
    ConversationTarget? target,
    MessageReadState readState = MessageReadState.none,
    List<BodySegment>? segments,
    void Function(MessageView view)? onReply,
    void Function(MessageView view)? onEdit,
  }) {
    return MessageBubble(
      text: view.text,
      isOwn: view.isOwn,
      timestamp: view.timestamp,
      sender: view.sender,
      author: view.author,
      decryptionFailed: view.decryptionFailed,
      media: view.media,
      controller: controller,
      id: view.id,
      body: view.body,
      reply: view.reply,
      edited: view.edited,
      deleted: view.deleted,
      reactions: view.id == null ? null : controller?.reactionsFor(view.id!),
      readState: readState,
      segments: segments,
      target: target,
      onReply: onReply,
      onEdit: onEdit,
    );
  }

  final String text;
  final bool isOwn;
  final int timestamp;
  final String? sender;
  final String? author;
  final bool decryptionFailed;
  final MediaDescriptor? media;
  final ChatController? controller;

  /// Wire id — required for reactions and delete (C5/C6).
  final String? id;

  final String? body;

  /// Reply ref `{id, u, e}` (C4).
  final Map<String, dynamic>? reply;
  final bool edited;
  final bool deleted;

  /// Aggregated reactions: emoji → usernames (C5).
  final Map<String, Set<String>>? reactions;

  final MessageReadState readState;

  /// Mention segments of the body already split for the current user (C8);
  /// null renders the body as plain text.
  final List<BodySegment>? segments;

  /// Conversation this message belongs to — routed to react/edit/delete.
  final ConversationTarget? target;

  /// Reply action from the long-press menu (C4).
  final void Function(MessageView view)? onReply;

  /// Edit action from the long-press menu (C6).
  final void Function(MessageView view)? onEdit;

  String get _time {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  String get _displayText => body ?? text;

  ConversationTarget? get _target => target;

  bool get _hasActions => id != null && _target != null && controller != null;

  /// `Reply` / `React` are available on everything but tombstones (C4–C6).
  bool get _canReply => !deleted && onReply != null;
  bool get _canReact => !deleted && _hasActions;

  /// Edit: own, text, not a tombstone (C6). Delete: own, not a tombstone.
  bool get _canEdit =>
      !deleted && isOwn && media == null && !decryptionFailed && onEdit != null;
  bool get _canDelete => !deleted && isOwn && _hasActions;

  bool get _menuEnabled => _canReply || _canReact || _canEdit || _canDelete;

  MessageView _view() {
    return MessageView(
      text: text,
      isOwn: isOwn,
      timestamp: timestamp,
      sender: sender,
      author: author,
      decryptionFailed: decryptionFailed,
      media: media,
      id: id,
      body: body,
      reply: reply,
      edited: edited,
      deleted: deleted,
    );
  }

  String? get _myUsername => controller?.me?.username;

  // ── Body rendering ───────────────────────────────────────────────────

  Widget _replyBlock() {
    final ref = reply;
    if (ref == null) return const SizedBox.shrink();
    final username = ref['u'];
    final excerpt = ref['e'];
    final authorName = username is String
        ? (controller?.displayNameOf(username) ?? username)
        : '';
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.only(left: 8),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: AppColors.accentSoft.withValues(alpha: 0.6), width: 2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            authorName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: isOwn ? const Color(0xB3FFFFFF) : AppColors.accentSoft,
            ),
          ),
          if (excerpt is String)
            Text(
              excerpt,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                height: 1.3,
                color: isOwn ? const Color(0x99FFFFFF) : AppColors.textMuted,
              ),
            ),
        ],
      ),
    );
  }

  Widget _bodyText() {
    final style = TextStyle(
      fontSize: 14,
      height: 1.4,
      color: isOwn ? Colors.white : AppColors.textBody,
    );
    final segs = segments;
    final hasMention = segs != null && segs.any((segment) => segment.isMention);
    if (!hasMention) {
      return Text(_displayText, style: style);
    }
    return Text.rich(
      TextSpan(
        children: [
          for (final segment in segs)
            segment.isMention
                ? TextSpan(
                    text: segment.text,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.4,
                      fontWeight: FontWeight.w600,
                      color: isOwn ? Colors.white : AppColors.accentSoft,
                    ),
                  )
                : TextSpan(text: segment.text, style: style),
        ],
      ),
    );
  }

  Widget _content() {
    if (media != null && !decryptionFailed && controller != null) {
      return MediaAttachment(descriptor: media!, controller: controller!);
    }
    if (decryptionFailed) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.lock_outline,
            size: 13,
            color: isOwn ? const Color(0xB3FFFFFF) : AppColors.textMuted,
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 13,
                fontStyle: FontStyle.italic,
                height: 1.4,
                color: isOwn ? const Color(0xB3FFFFFF) : AppColors.textSecondary,
              ),
            ),
          ),
        ],
      );
    }
    // No reply → no inner column, so the bubble stays a single Column
    // (keeps existing widget finders working).
    if (reply == null || media != null) return _bodyText();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _replyBlock(),
        _bodyText(),
      ],
    );
  }

  // ── Reactions (C5) ───────────────────────────────────────────────────

  List<String> get _pillEmojis {
    final agg = reactions;
    if (agg == null) return const <String>[];
    return [
      for (final emoji in reactionEmojis)
        if ((agg[emoji] ?? const <String>{}).isNotEmpty) emoji,
    ];
  }

  void _togglePill(String emoji) {
    final ctl = controller;
    final convo = _target;
    final messageId = id;
    if (ctl == null || convo == null || messageId == null) return;
    // Tapping our own pill removes it; additions go through the picker (C5).
    final mine = (reactions?[emoji] ?? const <String>{}).contains(_myUsername);
    if (!mine) return;
    ctl.toggleReaction(convo, messageId, emoji);
  }

  Widget _reactionPills() {
    final agg = reactions;
    if (deleted || agg == null) return const SizedBox.shrink();
    final pills = _pillEmojis;
    if (pills.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsets.only(top: 3, left: isOwn ? 0 : 4, right: isOwn ? 4 : 0),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          for (final emoji in pills)
            _ReactionPill(
              emoji: emoji,
              count: (agg[emoji] ?? const <String>{}).length,
              mine: (agg[emoji] ?? const <String>{}).contains(_myUsername),
              onTap: () => _togglePill(emoji),
            ),
        ],
      ),
    );
  }

  // ── Time / edited / read ticks (C2, C6) ──────────────────────────────

  Widget _metaRow() {
    return Padding(
      padding: EdgeInsets.only(left: isOwn ? 0 : 4, right: isOwn ? 4 : 0),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            _time,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w400,
              color: AppColors.textMuted,
            ),
          ),
          if (edited)
            const Text(
              ' (edited)',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w400,
                color: AppColors.textMuted,
              ),
            ),
          if (readState == MessageReadState.sent)
            const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Text(
                '✓',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            ),
          if (readState == MessageReadState.read)
            const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Text(
                '✓✓',
                style: TextStyle(fontSize: 11, color: AppColors.accentSoft),
              ),
            ),
        ],
      ),
    );
  }

  // ── Long-press menu / picker / delete dialog (C4–C6) ─────────────────

  Future<void> _openMenu(BuildContext context) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_canReply)
                ListTile(
                  title: const Text('Reply'),
                  onTap: () => Navigator.pop(sheetContext, 'reply'),
                ),
              if (_canReact)
                ListTile(
                  title: const Text('React'),
                  onTap: () => Navigator.pop(sheetContext, 'react'),
                ),
              if (_canEdit)
                ListTile(
                  title: const Text('Edit'),
                  onTap: () => Navigator.pop(sheetContext, 'edit'),
                ),
              if (_canDelete)
                ListTile(
                  title: const Text(
                    'Delete',
                    style: TextStyle(color: AppColors.dangerSoft),
                  ),
                  onTap: () => Navigator.pop(sheetContext, 'delete'),
                ),
            ],
          ),
        );
      },
    );
    switch (action) {
      case 'reply':
        onReply?.call(_view());
      case 'react':
        if (context.mounted) await _openPicker(context);
      case 'edit':
        onEdit?.call(_view());
      case 'delete':
        if (context.mounted) await _confirmDelete(context);
      default:
        break;
    }
  }

  Future<void> _openPicker(BuildContext context) async {
    final emoji = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 16),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                // Fixed quick-picker set, spec order (C5).
                for (final candidate in reactionEmojis)
                  InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => Navigator.pop(sheetContext, candidate),
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Text(candidate, style: const TextStyle(fontSize: 22)),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
    final convo = _target;
    final messageId = id;
    if (emoji == null || convo == null || messageId == null) return;
    controller?.toggleReaction(convo, messageId, emoji);
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Delete message for everyone?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;
    final convo = _target;
    final messageId = id;
    if (convo == null || messageId == null) return;
    controller?.deleteMessage(convo, messageId);
  }

  @override
  Widget build(BuildContext context) {
    final showSender = sender != null && !isOwn;
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = (constraints.maxWidth * 0.72).clamp(160.0, 340.0);
        return GestureDetector(
          onLongPress:
              _menuEnabled ? () => _openMenu(context) : null,
          behavior: HitTestBehavior.opaque,
          child: Column(
            crossAxisAlignment:
                isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start,
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
                child: deleted
                    ? const Text(
                        'This message was deleted',
                        style: TextStyle(
                          fontSize: 14,
                          height: 1.4,
                          fontStyle: FontStyle.italic,
                          color: AppColors.textMuted,
                        ),
                      )
                    : _content(),
              ),
              _reactionPills(),
              const SizedBox(height: 3),
              _metaRow(),
            ],
          ),
        );
      },
    );
  }
}

/// One aggregated reaction below a bubble: emoji, plus the count when more
/// than one distinct user reacted (C5).
class _ReactionPill extends StatelessWidget {
  const _ReactionPill({
    required this.emoji,
    required this.count,
    required this.mine,
    required this.onTap,
  });

  final String emoji;
  final int count;
  final bool mine;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: mine ? AppColors.accentTint : AppColors.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: mine ? AppColors.accentBorder : AppColors.border,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 12)),
            if (count > 1) ...[
              const SizedBox(width: 3),
              Text(
                '$count',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: mine ? AppColors.accentSoft : AppColors.textSecondary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
