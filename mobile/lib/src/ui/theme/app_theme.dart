// Dark zinc + indigo Material 3 theme.
//
// The palette mirrors the web client's Tailwind tokens from
// `frontend/src/index.css`: zinc-950 backgrounds, zinc-900 glass surfaces,
// indigo-500/600 accents, green/amber/red connection states.

import 'package:flutter/material.dart';

/// Shared color tokens for the whole app.
abstract final class AppColors {
  /// zinc-950 — the app background.
  static const background = Color(0xFF09090B);

  /// zinc-900 — solid surfaces (headers, sheets, snackbars).
  static const surface = Color(0xFF18181B);

  /// Translucent zinc-900 — glass panels (web `--color-surface`).
  static const surfaceGlass = Color(0xCC18181B);

  /// zinc-800 — inputs, chips, peer message bubbles.
  static const surfaceAlt = Color(0xFF27272A);

  /// Translucent zinc-800 — input fills (web `bg-zinc-800/50`).
  static const fill = Color(0xB327272A);

  /// Hairline border (web `--color-border`).
  static const border = Color(0x803F3F46);

  /// Solid zinc-700 — input borders.
  static const borderStrong = Color(0xFF3F3F46);

  /// indigo-500 — the accent.
  static const accent = Color(0xFF6366F1);

  /// indigo-400 — accent text and focus rings.
  static const accentSoft = Color(0xFF818CF8);

  /// indigo-600 — primary buttons and own message bubbles.
  static const accentDeep = Color(0xFF4F46E5);

  /// indigo-600 at 20% — selected rows (web `bg-indigo-600/20`).
  static const accentTint = Color(0x334F46E5);

  /// indigo-500 at 30% — selected row border (web `border-indigo-500/30`).
  static const accentBorder = Color(0x4D6366F1);

  /// zinc-50 — primary text.
  static const textPrimary = Color(0xFFFAFAFA);

  /// zinc-100 — text inside peer bubbles.
  static const textBody = Color(0xFFF4F4F5);

  /// zinc-400 — secondary text.
  static const textSecondary = Color(0xFFA1A1AA);

  /// zinc-500 — muted text and placeholders.
  static const textMuted = Color(0xFF71717A);

  /// green-500 — connected.
  static const online = Color(0xFF22C55E);

  /// yellow-500 — connecting.
  static const warning = Color(0xFFEAB308);

  /// red-500 — disconnected / destructive accents.
  static const danger = Color(0xFFEF4444);

  /// red-400 — error text (web `text-red-400`).
  static const dangerSoft = Color(0xFFF87171);

  /// Amber banner fill (web `bg-amber-500/10`).
  static const warningTint = Color(0x1AEAB308);

  /// Amber banner border (web `border-amber-500/20`).
  static const warningBorder = Color(0x33EAB308);

  /// Red banner fill for a lost connection.
  static const dangerTint = Color(0x1AEF4444);

  /// Red banner border for a lost connection.
  static const dangerBorder = Color(0x33EF4444);
}

/// Builds the single dark [ThemeData] used by `MaterialApp`.
ThemeData buildAppTheme() {
  final base = ThemeData(brightness: Brightness.dark, useMaterial3: true);
  final scheme = base.colorScheme.copyWith(
    primary: AppColors.accent,
    onPrimary: Colors.white,
    primaryContainer: AppColors.accentDeep,
    onPrimaryContainer: Colors.white,
    secondary: AppColors.accentSoft,
    onSecondary: Colors.white,
    surface: AppColors.surface,
    onSurface: AppColors.textPrimary,
    onSurfaceVariant: AppColors.textSecondary,
    outline: AppColors.borderStrong,
    outlineVariant: AppColors.border,
    error: AppColors.danger,
    onError: Colors.white,
    surfaceContainerHighest: AppColors.surfaceAlt,
  );

  return base.copyWith(
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.background,
    textTheme: _textTheme,
    splashFactory: InkSparkle.splashFactory,
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: AppColors.accent,
      selectionColor: AppColors.accentTint,
      selectionHandleColor: AppColors.accent,
    ),
    inputDecorationTheme: const InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: AppColors.fill,
      contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: TextStyle(
        color: AppColors.textMuted,
        fontSize: 14,
        fontWeight: FontWeight.w400,
      ),
      labelStyle: TextStyle(
        color: AppColors.textSecondary,
        fontSize: 14,
        fontWeight: FontWeight.w500,
      ),
      errorStyle: TextStyle(
        color: AppColors.dangerSoft,
        fontSize: 12,
        fontWeight: FontWeight.w400,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: AppColors.borderStrong),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: AppColors.accent, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: AppColors.danger),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: AppColors.danger, width: 1.5),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.accentDeep,
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0x804F46E5),
        disabledForegroundColor: const Color(0xB3FFFFFF),
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        elevation: 0,
        textStyle: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.1,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.textSecondary,
        minimumSize: const Size(44, 44),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: AppColors.textSecondary,
        minimumSize: const Size(44, 44),
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith<Color?>((states) {
        if (states.contains(WidgetState.selected)) return AppColors.accent;
        return Colors.transparent;
      }),
      checkColor: const WidgetStatePropertyAll<Color?>(Colors.white),
      side: const BorderSide(color: AppColors.borderStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.surfaceAlt,
      contentTextStyle: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 13,
        height: 1.4,
      ),
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.border,
      thickness: 1,
      space: 1,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: AppColors.border),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.accent,
      strokeWidth: 2,
    ),
  );
}

const TextTheme _textTheme = TextTheme(
  headlineSmall: TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
    height: 1.2,
    color: AppColors.textPrimary,
  ),
  titleLarge: TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    height: 1.3,
    color: AppColors.textPrimary,
  ),
  titleMedium: TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.1,
    height: 1.3,
    color: AppColors.textPrimary,
  ),
  titleSmall: TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.35,
    color: AppColors.textPrimary,
  ),
  bodyLarge: TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: AppColors.textPrimary,
  ),
  bodyMedium: TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.45,
    color: AppColors.textPrimary,
  ),
  bodySmall: TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.4,
    color: AppColors.textSecondary,
  ),
  labelLarge: TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    color: AppColors.textPrimary,
  ),
  labelMedium: TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.2,
    color: AppColors.textSecondary,
  ),
  labelSmall: TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.8,
    color: AppColors.textMuted,
  ),
);
