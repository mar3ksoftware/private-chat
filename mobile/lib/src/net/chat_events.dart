/// Event names from `backend/src/types.ts`.
///
/// Kept as string constants (rather than an enum) because the values are the
/// literal Socket.io event names used on the wire.
abstract final class ChatEvents {
  // Client -> server.
  static const userJoin = 'user:join';
  static const messageSend = 'message:send';
  static const e2eePublicKey = 'e2ee:public_key';
  static const userRegister = 'user:register';
  static const userLogin = 'user:login';
  static const groupCreate = 'group:create';
  static const groupMessageSend = 'group:message:send';
  static const groupMemberAdd = 'group:member:add';
  static const groupMemberRemove = 'group:member:remove';
  static const groupKickVote = 'group:kick:vote';
  static const typingSend = 'typing:send';
  static const receiptRead = 'receipt:read';
  static const messageReact = 'message:react';
  static const messageEdit = 'message:edit';
  static const messageDelete = 'message:delete';
  static const profileUpdate = 'profile:update';

  // Server -> client.
  static const mediaToken = 'media:token';
  static const userJoined = 'user:joined';
  static const userLeft = 'user:left';
  static const privateMessage = 'private_message';
  static const deliveryFailed = 'delivery_failed';
  static const messageRejected = 'message_rejected';
  static const activeUsers = 'active_users';
  static const activeGroups = 'active_groups';
  static const error = 'error';
  static const registerSuccess = 'register_success';
  static const registerError = 'register_error';
  static const loginSuccess = 'login_success';
  static const loginError = 'login_error';
  static const groupCreated = 'group:created';
  static const groupCreatedError = 'group:created_error';
  static const groupMessage = 'group:message';
  static const groupMessageDeliveryFailed = 'group:message_delivery_failed';
  static const usersDirectory = 'users:directory';
  static const typingChanged = 'typing:changed';
  static const receiptReadIn = 'receipt:read';
  static const messageReacted = 'message:reacted';
  static const messageEdited = 'message:edited';
  static const messageDeleted = 'message:deleted';
  static const profileUpdated = 'profile:updated';
  static const groupMemberRemoved = 'group:member:removed';
  static const groupKickTally = 'group:kick:tally';

  // Socket.io lifecycle.
  static const connect = 'connect';
  static const disconnect = 'disconnect';
  static const connectError = 'connect_error';
  static const reconnectAttempt = 'reconnect_attempt';
}
