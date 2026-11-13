import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../../utils/mentions.dart';
import 'empty_state.dart';
import 'message_bubble.dart';

/// Scrollable message history that follows new messages, with a centered
/// empty state when the conversation has no messages yet.
class MessageList extends StatefulWidget {
  const MessageList({
    super.key,
    required this.messages,
    this.emptyTitle = 'Start of conversation',
    this.controller,
    this.target,
    this.showReadTicks = false,
    this.readUpTo = 0,
    this.onReply,
    this.onEdit,
  });

  final List<MessageView> messages;
  final String emptyTitle;

  /// Passed through to bubbles so media messages can fetch their files and
  /// menu actions (react/edit/delete) can reach the controller.
  final ChatController? controller;

  /// Conversation the messages belong to — enables the bubble menu.
  final ConversationTarget? target;

  /// True for DMs: own bubbles get sent/read ticks (C2).
  final bool showReadTicks;

  /// Highest `receipt:read` upTo received from the DM peer (C2).
  final int readUpTo;

  /// Reply action bubbling up to the composer (C4).
  final void Function(MessageView view)? onReply;

  /// Edit action bubbling up to the composer (C6).
  final void Function(MessageView view)? onEdit;

  @override
  State<MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<MessageList> {
  final ScrollController _scrollController = ScrollController();
  double? _lastKeyboardInset;

  List<MessageView> get _messages => widget.messages;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
  }

  @override
  void didUpdateWidget(MessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != oldWidget.messages.length) {
      _animateToBottom();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    final previous = _lastKeyboardInset;
    _lastKeyboardInset = inset;
    if (previous != null && previous != inset) {
      // Keep the newest message (and the composer) in view as the keyboard
      // opens or closes.
      _jumpToBottom();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _jumpToBottom() {
    if (!mounted || !_scrollController.hasClients) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
    });
  }

  void _animateToBottom() {
    if (!mounted || !_scrollController.hasClients) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
      );
    });
  }

  /// Mention segments of [message] addressed to us (C8); plain-text bodies
  /// and tombstones skip the split so they render as a single Text.
  List<BodySegment>? _segmentsFor(MessageView message) {
    final controller = widget.controller;
    final body = message.body;
    if (controller == null || body == null || message.deleted) return null;
    final known = <String>{
      ...controller.directory,
      for (final user in controller.users) user.username,
      if (controller.me != null) controller.me!.username,
    };
    final isGroup = widget.target?.isGroup ?? false;
    return splitMentions(
      body,
      known.toList(),
      controller.me?.username ?? '',
      isGroup,
    );
  }

  MessageReadState _readStateFor(MessageView message) {
    if (!widget.showReadTicks || !message.isOwn) {
      return MessageReadState.none;
    }
    return widget.readUpTo >= message.timestamp
        ? MessageReadState.read
        : MessageReadState.sent;
  }

  @override
  Widget build(BuildContext context) {
    if (_messages.isEmpty) {
      return EmptyState(
        icon: Icons.chat_bubble_outline,
        title: widget.emptyTitle,
        subtitle: 'Messages you send appear here, end to end encrypted.',
      );
    }
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      itemCount: _messages.length,
      itemBuilder: (context, index) {
        final message = _messages[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: MessageBubble.fromView(
            message,
            controller: widget.controller,
            target: widget.target,
            readState: _readStateFor(message),
            segments: _segmentsFor(message),
            onReply: widget.onReply,
            onEdit: widget.onEdit,
          ),
        );
      },
    );
  }
}
