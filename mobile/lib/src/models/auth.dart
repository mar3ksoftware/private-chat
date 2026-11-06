import 'errors.dart';
import 'json_utils.dart';

/// Shared shape for `user:register` and `user:login`.
///
/// The backend's Zod schemas are `strictObject`s, so `pin` must be omitted
/// entirely when it is not set rather than sent as `null`.
class AuthPayload {
  const AuthPayload({
    required this.username,
    required this.password,
    this.pin,
  });

  final String username;
  final String password;
  final String? pin;

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      'username': username,
      'password': password,
    };
    final value = pin;
    if (value != null && value.isNotEmpty) {
      json['pin'] = value;
    }
    return json;
  }

  AuthPayload copyWith({String? username, String? password, String? pin}) {
    return AuthPayload(
      username: username ?? this.username,
      password: password ?? this.password,
      pin: pin ?? this.pin,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is AuthPayload &&
        other.username == username &&
        other.password == password &&
        other.pin == pin;
  }

  @override
  int get hashCode => Object.hash(username, password, pin);
}

/// Outbound `user:register` payload.
class RegisterPayload extends AuthPayload {
  const RegisterPayload({
    required super.username,
    required super.password,
    super.pin,
  });

  factory RegisterPayload.fromJson(Map<String, dynamic> json) {
    return RegisterPayload(
      username: readString(json['username']),
      password: readString(json['password']),
      pin: readNullableString(json['pin']),
    );
  }
}

/// Outbound `user:login` payload.
class LoginPayload extends AuthPayload {
  const LoginPayload({
    required super.username,
    required super.password,
    super.pin,
  });

  factory LoginPayload.fromJson(Map<String, dynamic> json) {
    return LoginPayload(
      username: readString(json['username']),
      password: readString(json['password']),
      pin: readNullableString(json['pin']),
    );
  }
}

/// Parsed form of `register_success` / `login_success` /
/// `register_error` / `login_error`.
sealed class AuthResult {
  const AuthResult();

  factory AuthResult.fromJson(Map<String, dynamic> json) {
    final kind = readString(json['kind']);
    if (kind == 'login_success' || kind == 'register_success') {
      return AuthSuccess(
        kind: kind,
        userId: readString(json['userId']),
        username: readString(json['username']),
      );
    }
    return AuthFailure(
      kind: kind.isEmpty ? 'auth_error' : kind,
      reason: readString(json['reason']),
    );
  }

  String get kind;
  bool get isSuccess => this is AuthSuccess;
}

final class AuthSuccess extends AuthResult {
  const AuthSuccess({
    required this.kind,
    required this.userId,
    required this.username,
  });

  @override
  final String kind;
  final String userId;
  final String username;

  @override
  bool get isSuccess => true;

  @override
  String toString() => 'AuthSuccess($kind, $username)';
}

final class AuthFailure extends AuthResult {
  const AuthFailure({required this.kind, required this.reason});

  @override
  final String kind;
  final String reason;

  /// User-facing text for this failure.
  String get message => friendlyReason(reason);

  @override
  bool get isSuccess => false;

  @override
  String toString() => 'AuthFailure($kind, $reason)';
}

/// The wire contract uses the same success/error shape for both flows.
typedef LoginResult = AuthResult;
typedef RegisterResult = AuthResult;
