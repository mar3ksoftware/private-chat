import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';

/// Bottom sheet for a group's membership: roster, kick votes and — for
/// admins — add/remove actions.
void showGroupMembersSheet(
  BuildContext context, {
  required ChatController controller,
  required String groupId,
}) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => GroupMembersSheet(
      controller: controller,
      groupId: groupId,
    ),
  );
}

class GroupMembersSheet extends StatefulWidget {
  const GroupMembersSheet({
    super.key,
    required this.controller,
    required this.groupId,
  });

  final ChatController controller;
  final String groupId;

  @override
  State<GroupMembersSheet> createState() => _GroupMembersSheetState();
}

class _GroupMembersSheetState extends State<GroupMembersSheet> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  GroupInfo? _findGroup(ChatController controller) {
    for (final group in controller.groups) {
      if (group.groupId == widget.groupId) return group;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
        child: ListenableBuilder(
          listenable: controller,
          builder: (context, _) {
            final group = _findGroup(controller);
            if (group == null) {
              // The group disappeared while the sheet was open (we were
              // removed from it) — close rather than show an empty shell.
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) Navigator.of(context).pop();
              });
              return const SizedBox.shrink();
            }

            final me = controller.me;
            final online = <String>{
              for (final user in controller.users) user.username,
            };
            final isAdmin = group.members.any(
              (member) => member.userId == me?.userId && member.isAdmin,
            );
            final tally = controller.kickTallyFor(group.groupId);
            final voteActive = tally != null && tally.status == 'active';
            final query = _searchController.text.trim().toLowerCase();
            final candidates = <String>[
              for (final name in controller.directory)
                if (!group.hasMember(name) &&
                    name != me?.username &&
                    name.toLowerCase().contains(query))
                  name,
            ]..sort();

            return SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 36,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.borderStrong,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Members (${group.members.length})',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.2,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (tally != null) ...[
                    const SizedBox(height: 14),
                    _TallySection(
                      tally: tally,
                      myUsername: me?.username,
                      onVote: () => controller.kickVote(
                        group.groupId,
                        tally.username,
                      ),
                    ),
                  ],
                  const SizedBox(height: 14),
                  const Text(
                    'MEMBERS',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.8,
                      color: AppColors.textMuted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  for (final member in group.members)
                    _MemberRow(
                      member: member,
                      isOnline: online.contains(member.username),
                      showRemove:
                          isAdmin &&
                          member.userId != group.createdBy &&
                          member.username != me?.username,
                      showVote:
                          !voteActive &&
                          member.userId != group.createdBy &&
                          member.username != me?.username,
                      onRemove: () =>
                          controller.removeMember(group.groupId, member.username),
                      onVote: () =>
                          controller.kickVote(group.groupId, member.username),
                    ),
                  if (isAdmin) ...[
                    const SizedBox(height: 16),
                    const Text(
                      'ADD MEMBER',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.8,
                        color: AppColors.textMuted,
                      ),
                    ),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _searchController,
                      onChanged: (_) => setState(() {}),
                      style: const TextStyle(
                        fontSize: 14,
                        color: AppColors.textPrimary,
                      ),
                      decoration: const InputDecoration(
                        hintText: 'Add member…',
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (candidates.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          'No users to add',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.textMuted,
                          ),
                        ),
                      )
                    else
                      for (final name in candidates)
                        _AddCandidateTile(
                          username: name,
                          isOnline: online.contains(name),
                          onTap: () => controller.addMember(group.groupId, name),
                        ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── Tally ────────────────────────────────────────────────────────────────

class _TallySection extends StatelessWidget {
  const _TallySection({
    required this.tally,
    required this.myUsername,
    required this.onVote,
  });

  final KickTally tally;
  final String? myUsername;
  final VoidCallback onVote;

  @override
  Widget build(BuildContext context) {
    final voted = myUsername != null && tally.votes.contains(myUsername);
    final String status;
    switch (tally.status) {
      case 'passed':
        status = 'Vote passed';
      case 'expired':
        status = 'Vote failed';
      default:
        status = '${tally.votes.length}/${tally.required}';
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 6),
      decoration: BoxDecoration(
        color: AppColors.fill,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  tally.username,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              Text(
                status,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: tally.status == 'passed'
                      ? AppColors.online
                      : tally.status == 'expired'
                      ? AppColors.textMuted
                      : AppColors.accentSoft,
                ),
              ),
              const SizedBox(width: 4),
              if (tally.status == 'active')
                TextButton(
                  onPressed: voted ? null : onVote,
                  child: Text(voted ? 'Voted' : 'Vote'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────

class _MemberRow extends StatelessWidget {
  const _MemberRow({
    required this.member,
    required this.isOnline,
    required this.showRemove,
    required this.showVote,
    required this.onRemove,
    required this.onVote,
  });

  final GroupMember member;
  final bool isOnline;
  final bool showRemove;
  final bool showVote;
  final VoidCallback onRemove;
  final VoidCallback onVote;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 44),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 46,
            child: isOnline
                ? Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.online,
                      boxShadow: [
                        BoxShadow(color: Color(0x5522C55E), blurRadius: 5),
                      ],
                    ),
                  )
                : const Text(
                    'offline',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
                  ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  member.displayNameOrUsername,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (member.displayName != null &&
                    member.displayName != member.username)
                  Text(
                    member.username,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
                  ),
              ],
            ),
          ),
          if (member.isAdmin)
            Container(
              margin: const EdgeInsets.only(left: 8),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.accentTint,
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Text(
                'admin',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: AppColors.accentSoft,
                ),
              ),
            ),
          if (showRemove)
            IconButton(
              tooltip: 'Remove ${member.username}',
              onPressed: onRemove,
              icon: const Icon(
                Icons.person_remove_outlined,
                size: 20,
                color: AppColors.dangerSoft,
              ),
            ),
          if (showVote)
            IconButton(
              tooltip: 'Vote to kick ${member.username}',
              onPressed: onVote,
              icon: const Icon(
                Icons.how_to_vote,
                size: 20,
                color: AppColors.textSecondary,
              ),
            ),
        ],
      ),
    );
  }
}

class _AddCandidateTile extends StatelessWidget {
  const _AddCandidateTile({
    required this.username,
    required this.isOnline,
    required this.onTap,
  });

  final String username;
  final bool isOnline;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 44),
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                username,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.textBody,
                ),
              ),
            ),
            if (isOnline)
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.online,
                  boxShadow: [
                    BoxShadow(color: Color(0x5522C55E), blurRadius: 5),
                  ],
                ),
              )
            else
              const Text(
                'offline',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            const SizedBox(width: 10),
            const Icon(Icons.add, size: 18, color: AppColors.accentSoft),
          ],
        ),
      ),
    );
  }
}
