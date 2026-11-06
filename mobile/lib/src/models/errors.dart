import 'json_utils.dart';

/// Backend error reasons are machine-readable. Translate them before they
/// reach the UI. Kept in sync with `FRIENDLY_REASONS` in the web client.
const Map<String, String> friendlyReasons = <String, String>{
  'invalid_credentials': 'Incorrect username or password.',
  'username_taken': 'That username is already taken.',
  'validation_failed': 'Please check your entries and try again.',
  'rate_limited': 'Too many attempts. Please wait a moment and try again.',
  'internal_error': 'Something went wrong. Please try again.',
  'user_not_found': 'That user is not online.',
  'user_disconnected': 'That user has disconnected.',
  'pin_required': 'This account requires a PIN.',
  'pin_invalid': 'Incorrect PIN.',
  'room_not_found': 'That conversation is no longer available.',
  'not_in_room': 'You are not a member of that conversation.',
};

String friendlyReason(String reason) => friendlyReasons[reason] ?? reason;

/// The backend sometimes emits free-form messages (`error`, `message_rejected`,
/// group errors) instead of the machine-readable reason codes. Map the known
/// ones too, then fall back to the original text.
String friendlyErrorText(String message) {
  final direct = friendlyReasons[message];
  if (direct != null) return direct;

  switch (message.trim().toLowerCase()) {
    case 'username taken':
      return friendlyReasons['username_taken']!;
    case 'rate limit exceeded':
      return friendlyReasons['rate_limited']!;
    case 'group not found':
      return 'That group no longer exists.';
    case 'not a group member':
      return 'You are not a member of that group.';
  }
  return message;
}

/// Inbound `error` payload.
class ErrorPayload {
  const ErrorPayload({required this.message});

  factory ErrorPayload.fromJson(Map<String, dynamic> json) {
    return ErrorPayload(message: readString(json['message']));
  }

  final String message;

  Map<String, dynamic> toJson() => <String, dynamic>{'message': message};
}

/// Inbound `message_rejected` payload.
class MessageRejectedPayload {
  const MessageRejectedPayload({required this.reason});

  factory MessageRejectedPayload.fromJson(Map<String, dynamic> json) {
    return MessageRejectedPayload(reason: readString(json['reason']));
  }

  final String reason;

  Map<String, dynamic> toJson() => <String, dynamic>{'reason': reason};
}

/// Inbound `group:created_error` and `group:message_delivery_failed` payload.
class GroupErrorPayload {
  const GroupErrorPayload({required this.message});

  factory GroupErrorPayload.fromJson(Map<String, dynamic> json) {
    return GroupErrorPayload(message: readString(json['message']));
  }

  final String message;

  Map<String, dynamic> toJson() => <String, dynamic>{'message': message};
}

/// Inbound `delivery_failed` payload.
class DeliveryFailedPayload {
  const DeliveryFailedPayload({required this.reason, required this.to});

  factory DeliveryFailedPayload.fromJson(Map<String, dynamic> json) {
    return DeliveryFailedPayload(
      reason: readString(json['reason']),
      to: readString(json['to']),
    );
  }

  final String reason;
  final String to;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'reason': reason,
    'to': to,
  };
}
