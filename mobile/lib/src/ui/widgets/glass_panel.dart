import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Translucent panel with a hairline border — the native counterpart of the
/// web client's `.glass` class.
class GlassPanel extends StatelessWidget {
  const GlassPanel({
    super.key,
    required this.child,
    this.radius = 20,
    this.padding,
  });

  final Widget child;
  final double radius;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final decorated = DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.surfaceGlass,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppColors.border),
      ),
      child: padding != null ? Padding(padding: padding!, child: child) : child,
    );
    return decorated;
  }
}
