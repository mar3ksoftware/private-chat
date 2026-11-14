// ── Profile validation (C9) ──
// Client-side mirror of the server rules; error strings are exact per spec D.

/// Result of validating a profile edit form.
class ProfileValidation {
  final String displayName;
  final String status;
  final String? nameError;
  final String? statusError;

  const ProfileValidation({
    required this.displayName,
    required this.status,
    required this.nameError,
    required this.statusError,
  });

  bool get isValid => nameError == null && statusError == null;
}

const int kMaxDisplayNameLength = 32;
const int kMaxStatusLength = 80;

// Control characters (Cc category), matching the frontend's /\p{Cc}/u.
final RegExp _controlChars = RegExp('[\\u0000-\\u001F\\u007F-\\u009F]');

const String kNameTooLongError = 'Display name is too long (max 32).';
const String kStatusTooLongError = 'Status is too long (max 80).';

ProfileValidation validateProfile(String rawDisplayName, String rawStatus) {
  final displayName = rawDisplayName.trim();
  final status = rawStatus.trim();

  final nameError = displayName.isEmpty ||
          displayName.length > kMaxDisplayNameLength ||
          _controlChars.hasMatch(displayName)
      ? kNameTooLongError
      : null;

  final statusError =
          status.length > kMaxStatusLength || _controlChars.hasMatch(status)
      ? kStatusTooLongError
      : null;

  return ProfileValidation(
    displayName: displayName,
    status: status,
    nameError: nameError,
    statusError: statusError,
  );
}
