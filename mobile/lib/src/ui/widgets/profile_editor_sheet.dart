import 'package:flutter/material.dart';

import '../../state/chat_controller.dart';
import '../../utils/profile.dart';
import '../theme/app_theme.dart';

/// Bottom-sheet profile editor for the signed-in user (C9): display name
/// and status with inline validation. Reachable from the conversation list
/// app bar.
void showProfileEditorSheet(
  BuildContext context, {
  required ChatController controller,
}) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => ProfileEditorSheet(controller: controller),
  );
}

class ProfileEditorSheet extends StatefulWidget {
  const ProfileEditorSheet({super.key, required this.controller});

  final ChatController controller;

  @override
  State<ProfileEditorSheet> createState() => _ProfileEditorSheetState();
}

class _ProfileEditorSheetState extends State<ProfileEditorSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _statusController;
  String? _nameError;
  String? _statusError;

  @override
  void initState() {
    super.initState();
    final username = widget.controller.me?.username ?? '';
    _nameController = TextEditingController(
      text: widget.controller.displayNameOf(username),
    );
    _statusController = TextEditingController(
      text: widget.controller.statusOf(username),
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _statusController.dispose();
    super.dispose();
  }

  void _save() {
    final validation = validateProfile(_nameController.text, _statusController.text);
    setState(() {
      _nameError = validation.nameError;
      _statusError = validation.statusError;
    });
    if (!validation.isValid) return;
    final sent = widget.controller.updateProfile(
      _nameController.text,
      _statusController.text,
    );
    if (sent && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final username = widget.controller.me?.username ?? '';
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
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
              username,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.1,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              key: const Key('profile-display-name'),
              controller: _nameController,
              style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
              decoration: InputDecoration(
                labelText: 'Display name',
                errorText: _nameError,
                errorStyle: const TextStyle(
                  fontSize: 12,
                  color: AppColors.dangerSoft,
                ),
                labelStyle: const TextStyle(color: AppColors.textMuted),
                enabledBorder: const OutlineInputBorder(
                  borderSide: BorderSide(color: AppColors.border),
                ),
                focusedBorder: const OutlineInputBorder(
                  borderSide: BorderSide(color: AppColors.accent, width: 1.5),
                ),
                filled: true,
                fillColor: AppColors.fill,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('profile-status'),
              controller: _statusController,
              style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
              decoration: InputDecoration(
                labelText: 'Status',
                errorText: _statusError,
                errorStyle: const TextStyle(
                  fontSize: 12,
                  color: AppColors.dangerSoft,
                ),
                labelStyle: const TextStyle(color: AppColors.textMuted),
                enabledBorder: const OutlineInputBorder(
                  borderSide: BorderSide(color: AppColors.border),
                ),
                focusedBorder: const OutlineInputBorder(
                  borderSide: BorderSide(color: AppColors.accent, width: 1.5),
                ),
                filled: true,
                fillColor: AppColors.fill,
              ),
            ),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 6),
                IconButton(
                  tooltip: 'Save profile',
                  onPressed: _save,
                  icon: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: const BoxDecoration(
                      color: AppColors.accentDeep,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.check, size: 18, color: Colors.white),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
