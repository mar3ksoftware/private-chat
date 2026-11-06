import 'package:flutter/material.dart';

import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/empty_state.dart';
import 'chat_screen.dart';
import 'conversation_list.dart';

/// Width (dp) at which the layout switches from single-pane to master-detail.
const double kWideLayoutBreakpoint = 700;

/// App home once authenticated.
///
/// * Phones (< [kWideLayoutBreakpoint]): the conversation list; tapping a
///   user or group pushes [ChatScreen] (system back pops it).
/// * Tablets / landscape: two-pane master-detail — list left, chat right.
class ChatShell extends StatefulWidget {
  const ChatShell({super.key, required this.controller});

  final ChatController controller;

  @override
  State<ChatShell> createState() => _ChatShellState();
}

class _ChatShellState extends State<ChatShell> {
  bool _isWide = false;
  bool _layoutPrimed = false;
  bool _chatPushed = false;

  ChatController get _controller => widget.controller;

  bool get _hasSelection =>
      _controller.selectedPeer != null || _controller.selectedGroup != null;

  /// Called on every layout with the current pane mode; reconciles the
  /// pushed chat route when the breakpoint is crossed (e.g. rotation).
  void _onLayout(bool wide) {
    final wasWide = _isWide;
    _isWide = wide;
    if (!_layoutPrimed) {
      _layoutPrimed = true;
      return;
    }
    if (wasWide == wide) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _reconcileNavigation(wide: wide);
    });
  }

  void _reconcileNavigation({required bool wide}) {
    final navigator = Navigator.of(context);
    if (wide) {
      // The detail pane takes over; drop the pushed chat route only (never
      // routes opened above it, such as the create-group sheet).
      if (_chatPushed) {
        _chatPushed = false;
        navigator.pop();
      }
    } else if (!_chatPushed && !navigator.canPop() && _hasSelection) {
      // Back on a phone with an active conversation shows that chat again.
      _pushChat(
        peerUsername: _controller.selectedPeer,
        groupId: _controller.selectedGroup,
      );
    }
  }

  void _openPeer(String username) {
    _controller.selectPeer(username);
    if (!_isWide) _pushChat(peerUsername: username);
  }

  void _openGroup(String groupId) {
    _controller.selectGroup(groupId);
    if (!_isWide) _pushChat(groupId: groupId);
  }

  void _pushChat({String? peerUsername, String? groupId}) {
    _chatPushed = true;
    Navigator.of(context)
        .push<void>(
          MaterialPageRoute<void>(
            builder: (routeContext) => Scaffold(
              backgroundColor: AppColors.background,
              body: ChatScreen(
                controller: _controller,
                peerUsername: peerUsername,
                groupId: groupId,
                showBack: true,
              ),
            ),
          ),
        )
        .whenComplete(() {
          _chatPushed = false;
        });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= kWideLayoutBreakpoint;
        _onLayout(wide);
        return PopScope(
          // A selection on screen (list row or detail pane) is cleared by
          // the first back press; without one, back exits as usual.
          canPop: !_hasSelection,
          onPopInvokedWithResult: (didPop, result) {
            if (!didPop && _hasSelection) _controller.clearSelection();
          },
          child: Scaffold(
            backgroundColor: AppColors.background,
            body: SafeArea(
              child: wide ? _buildWide() : _buildPhone(),
            ),
          ),
        );
      },
    );
  }

  Widget _buildPhone() {
    return ConversationList(
      controller: _controller,
      onSelectPeer: _openPeer,
      onSelectGroup: _openGroup,
    );
  }

  Widget _buildWide() {
    final peer = _controller.selectedPeer;
    final groupId = _controller.selectedGroup;
    final Widget detail;
    if (peer != null) {
      detail = ChatScreen(
        controller: _controller,
        peerUsername: peer,
        showBack: false,
      );
    } else if (groupId != null) {
      detail = ChatScreen(
        controller: _controller,
        groupId: groupId,
        showBack: false,
      );
    } else {
      detail = const EmptyState(
        icon: Icons.forum_outlined,
        title: 'Select a conversation',
        subtitle: 'Choose a user or a group from the list to start chatting.',
      );
    }
    return Row(
      children: [
        SizedBox(
          width: 320,
          child: ConversationList(
            controller: _controller,
            onSelectPeer: _openPeer,
            onSelectGroup: _openGroup,
          ),
        ),
        const VerticalDivider(width: 1, thickness: 1),
        Expanded(child: detail),
      ],
    );
  }
}
