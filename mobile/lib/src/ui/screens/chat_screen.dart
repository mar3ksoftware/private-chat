import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/connection_status.dart';
import '../widgets/group_members_sheet.dart';
import '../widgets/message_bubble.dart';
import '../widgets/message_composer.dart';
import '../widgets/message_list.dart';

/// The conversation detail: header, message history and composer.
///
/// Rendered as the right pane in the two-pane layout (`showBack: false`)
/// and as a pushed full-screen route on phones (`showBack: true`).
class ChatScreen extends StatelessWidget {
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

  GroupInfo? _findGroup() {
    final id = groupId;
    if (id == null) return null;
    for (final group in controller.groups) {
      if (group.groupId == id) return group;
    }
    return null;
  }

  List<MessageView> _messages() {
    final peer = peerUsername;
    if (peer != null) {
      return [
        for (final message in controller.messagesForPeer(peer))
          MessageView.fromPrivate(message),
      ];
    }
    final id = groupId;
    if (id != null) {
      return [
        for (final message in controller.groupMessagesFor(id))
          MessageView.fromGroup(message),
      ];
    }
    return const <MessageView>[];
  }

  Future<bool> _send(String text) {
    final peer = peerUsername;
    if (peer != null) return controller.sendMessage(peer, text);
    final id = groupId;
    if (id != null) return controller.sendGroupMessage(id, text);
    return Future<bool>.value(false);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final group = _findGroup();
        final title =
            group?.name ??
            peerUsername ??
            (groupId != null ? 'Group' : 'Private Chat');
        return SafeArea(
          child: Column(
            children: [
              _ChatHeader(
                title: title,
                subtitle: group != null ? 'Group' : null,
                status: controller.connectionStatus,
                showBack: showBack,
                showStatusLabel: !showBack,
                onMembers: group == null
                    ? null
                    : () => showGroupMembersSheet(
                        context,
                        controller: controller,
                        groupId: group.groupId,
                      ),
                onLogout: () {
                  controller.logout();
                  // On phones the chat sits on top of the list; drop it so
                  // the auth screen underneath is visible right away.
                  if (showBack && Navigator.canPop(context)) {
                    Navigator.pop(context);
                  }
                },
              ),
              Expanded(child: MessageList(messages: _messages())),
              MessageComposer(
                enabled:
                    controller.connectionStatus == ConnectionStatus.connected,
                onSend: _send,
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
                      subtitle!,
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
