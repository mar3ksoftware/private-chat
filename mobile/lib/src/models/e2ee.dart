import 'json_utils.dart';

/// Outbound `e2ee:public_key` payload.
class E2eePublicKeyPayload {
  const E2eePublicKeyPayload({required this.to, required this.publicKey});

  factory E2eePublicKeyPayload.fromJson(Map<String, dynamic> json) {
    return E2eePublicKeyPayload(
      to: readString(json['to']),
      publicKey: readString(json['publicKey']),
    );
  }

  final String to;
  final String publicKey;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'to': to,
    'publicKey': publicKey,
  };
}

/// Inbound `e2ee:public_key` relay. The server attaches the sender identity.
class E2eePublicKeyRelay {
  const E2eePublicKeyRelay({
    required this.from,
    required this.fromUsername,
    required this.publicKey,
  });

  factory E2eePublicKeyRelay.fromJson(Map<String, dynamic> json) {
    return E2eePublicKeyRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      publicKey: readString(json['publicKey']),
    );
  }

  final String from;
  final String fromUsername;
  final String publicKey;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
    'publicKey': publicKey,
  };
}
