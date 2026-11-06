import 'package:flutter/material.dart';

import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';

/// Green/amber/red dot with an optional label, mirroring the web
/// `ConnectionStatus` component.
class ConnectionBadge extends StatelessWidget {
  const ConnectionBadge({
    super.key,
    required this.status,
    this.showLabel = true,
  });

  final ConnectionStatus status;
  final bool showLabel;

  Color get _color => switch (status) {
    ConnectionStatus.connected => AppColors.online,
    ConnectionStatus.connecting => AppColors.warning,
    ConnectionStatus.disconnected => AppColors.danger,
  };

  String get _label => switch (status) {
    ConnectionStatus.connected => 'Connected',
    ConnectionStatus.connecting => 'Connecting…',
    ConnectionStatus.disconnected => 'Disconnected',
  };

  @override
  Widget build(BuildContext context) {
    final color = _color;
    return Semantics(
      label: 'Connection status: $_label',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color,
              boxShadow: [
                BoxShadow(color: color.withValues(alpha: 0.55), blurRadius: 6),
              ],
            ),
          ),
          if (showLabel) ...[
            const SizedBox(width: 7),
            Text(
              _label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                letterSpacing: 0.2,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Slim banner shown under the list header while the socket is not
/// connected, matching the web sidebar's ephemeral status banner.
class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.status});

  final ConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final connecting = status == ConnectionStatus.connecting;
    final color = connecting ? AppColors.warning : AppColors.danger;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: connecting ? AppColors.warningTint : AppColors.dangerTint,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: connecting ? AppColors.warningBorder : AppColors.dangerBorder,
        ),
      ),
      child: Row(
        children: [
          Icon(
            connecting ? Icons.autorenew : Icons.wifi_off,
            size: 14,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              connecting ? 'Connecting…' : 'Disconnected',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
