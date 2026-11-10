import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/connection_status.dart';
import '../widgets/create_group_sheet.dart';
import '../widgets/empty_state.dart';

/// The master list: connection header, Users/Groups tabs, the roster and
/// the identity footer. Used full-screen on phones and as the left pane in
/// the two-pane layout.
class ConversationList extends StatefulWidget {
  const ConversationList({
    super.key,
    required this.controller,
    required this.onSelectPeer,
    required this.onSelectGroup,
  });

  final ChatController controller;
  final ValueChanged<String> onSelectPeer;
  final ValueChanged<String> onSelectGroup;

  @override
  State<ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends State<ConversationList> {
  bool _showGroups = false;

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final me = controller.me;
        final others = <UserInfo>[
          for (final user in controller.users)
            if (user.username != me?.username) user,
        ];
        final groups = controller.groups;
        final status = controller.connectionStatus;
        final selectedPeer = controller.selectedPeer;
        final selectedGroup = controller.selectedGroup;

        return DecoratedBox(
          decoration: const BoxDecoration(color: AppColors.surfaceGlass),
          child: Column(
            children: [
              _buildHeader(status),
              const Divider(height: 1),
              if (status != ConnectionStatus.connected)
                ConnectionBanner(status: status),
              _buildTabs(userCount: others.length, groupCount: groups.length),
              const Divider(height: 1),
              Expanded(
                child: _showGroups
                    ? _buildGroups(
                        groups: groups,
                        selectedGroup: selectedGroup,
                      )
                    : _buildUsers(
                        users: others,
                        selectedPeer: selectedPeer,
                      ),
              ),
              const Divider(height: 1),
              _buildFooter(me),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader(ConnectionStatus status) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          const Icon(
            Icons.lock_outline,
            size: 18,
            color: AppColors.accentSoft,
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'Scattered Keyhole',
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.2,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          ConnectionBadge(status: status),
        ],
      ),
    );
  }

  Widget _buildTabs({required int userCount, required int groupCount}) {
    return Row(
      children: [
        Expanded(
          child: _ListTab(
            label: 'Users ($userCount)',
            active: !_showGroups,
            onTap: () => setState(() => _showGroups = false),
          ),
        ),
        Expanded(
          child: _ListTab(
            label: 'Groups ($groupCount)',
            active: _showGroups,
            onTap: () => setState(() => _showGroups = true),
          ),
        ),
      ],
    );
  }

  Widget _buildUsers({
    required List<UserInfo> users,
    required String? selectedPeer,
  }) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 6),
          child: Row(
            children: [
              const Text(
                'ONLINE',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.8,
                  color: AppColors.textMuted,
                ),
              ),
              const Spacer(),
              _CountPill(count: users.length),
            ],
          ),
        ),
        Expanded(
          child: users.isEmpty
              ? const EmptyState(
                  icon: Icons.person_outline,
                  title: 'No other users online',
                  subtitle: 'People show up here while they are connected.',
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(10, 2, 10, 10),
                  children: [
                    for (final user in users)
                      _RosterRow(
                        key: ValueKey(user.userId),
                        selected: selectedPeer == user.username,
                        onTap: () => widget.onSelectPeer(user.username),
                        leading: const _PresenceDot(),
                        title: user.username,
                      ),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildGroups({
    required List<GroupInfo> groups,
    required String? selectedGroup,
  }) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: SizedBox(
            height: 44,
            width: double.infinity,
            child: Material(
              color: AppColors.accentTint,
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: _showCreateGroupSheet,
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.add, size: 17, color: AppColors.accentSoft),
                    SizedBox(width: 6),
                    Text(
                      'Create Group',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.accentSoft,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        Expanded(
          child: groups.isEmpty
              ? const EmptyState(
                  icon: Icons.group_outlined,
                  title: 'No groups yet',
                  subtitle: 'Create a group to message several people at once.',
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(10, 4, 10, 10),
                  children: [
                    for (final group in groups)
                      _RosterRow(
                        key: ValueKey(group.groupId),
                        selected: selectedGroup == group.groupId,
                        onTap: () => widget.onSelectGroup(group.groupId),
                        leading: const _HashBadge(),
                        title: group.name,
                        subtitle: group.members.length == 1
                            ? '1 member'
                            : '${group.members.length} members',
                      ),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildFooter(ActiveUser? me) {
    final username = me?.username ?? '…';
    final accountLabel = me?.isGuest == true ? 'Guest' : 'Account';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 6, 8),
      child: Row(
        children: [
          Flexible(
            child: Text(
              username,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              accountLabel,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          const Spacer(),
          IconButton(
            tooltip: 'Logout',
            onPressed: () => widget.controller.logout(),
            icon: const Icon(Icons.logout, size: 20),
          ),
        ],
      ),
    );
  }

  void _showCreateGroupSheet() {
    showCreateGroupSheet(context, controller: widget.controller);
  }
}

// ── Row building blocks ──────────────────────────────────────────────────

class _ListTab extends StatelessWidget {
  const _ListTab({
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
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 44),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              width: 2,
              color: active ? AppColors.accentSoft : Colors.transparent,
            ),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
            color: active ? AppColors.accentSoft : AppColors.textMuted,
          ),
        ),
      ),
    );
  }
}

class _CountPill extends StatelessWidget {
  const _CountPill({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$count',
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}

class _PresenceDot extends StatelessWidget {
  const _PresenceDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.online,
        boxShadow: [
          BoxShadow(color: Color(0x5522C55E), blurRadius: 5),
        ],
      ),
    );
  }
}

class _HashBadge extends StatelessWidget {
  const _HashBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text(
        '#',
        style: TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}

class _RosterRow extends StatelessWidget {
  const _RosterRow({
    super.key,
    required this.selected,
    required this.onTap,
    required this.leading,
    required this.title,
    this.subtitle,
  });

  final bool selected;
  final VoidCallback onTap;
  final Widget leading;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOut,
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: selected ? AppColors.accentTint : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: selected ? AppColors.accentBorder : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                leading,
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textMuted,
                          ),
                        ),
                    ],
                  ),
                ),
                if (selected)
                  const Icon(
                    Icons.check_rounded,
                    size: 18,
                    color: AppColors.accentSoft,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
