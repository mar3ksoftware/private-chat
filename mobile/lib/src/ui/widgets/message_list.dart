import 'package:flutter/material.dart';

import 'empty_state.dart';
import 'message_bubble.dart';

/// Scrollable message history that follows new messages, with a centered
/// empty state when the conversation has no messages yet.
class MessageList extends StatefulWidget {
  const MessageList({
    super.key,
    required this.messages,
    this.emptyTitle = 'Start of conversation',
  });

  final List<MessageView> messages;
  final String emptyTitle;

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
          child: MessageBubble.fromView(message),
        );
      },
    );
  }
}
