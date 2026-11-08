import { z } from 'zod';
import type { ValidationResult } from './types';
import { CONSTANTS } from './types';

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const usernameSchema = z
  .string()
  .min(CONSTANTS.MIN_USERNAME_LENGTH)
  .max(CONSTANTS.MAX_USERNAME_LENGTH)
  .regex(/^[a-zA-Z0-9_-]+$/);

const ivSchema = z.string().min(1).max(CONSTANTS.MAX_IV_LENGTH).regex(BASE64_PATTERN);

const userJoinPayloadSchema = z.strictObject({
  username: usernameSchema,
});

const messagePayloadSchema = z.strictObject({
  to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
  ciphertext: z.string().min(1).max(CONSTANTS.MAX_CIPHERTEXT_LENGTH),
  iv: ivSchema,
});

const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/)
  .optional();

const registerPayloadSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(CONSTANTS.MIN_PASSWORD_LENGTH).max(CONSTANTS.MAX_PASSWORD_LENGTH),
  pin: pinSchema,
});

const loginPayloadSchema = z.strictObject({
  username: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
  password: z.string().min(1).max(CONSTANTS.MAX_PASSWORD_LENGTH),
  pin: pinSchema,
});

const e2eePublicKeyPayloadSchema = z.strictObject({
  to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
  publicKey: z.string().min(1).max(CONSTANTS.MAX_PUBLIC_KEY_LENGTH),
});

const groupCreatePayloadSchema = z.strictObject({
  name: z.string().min(1).max(CONSTANTS.MAX_GROUP_NAME_LENGTH),
  members: z
    .array(z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH))
    .max(CONSTANTS.MAX_GROUP_MEMBERS),
});

const groupMessagePayloadSchema = z.strictObject({
  groupId: z.string().min(1),
  ciphertexts: z
    .array(
      z.strictObject({
        to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
        ciphertext: z.string().min(1).max(CONSTANTS.MAX_CIPHERTEXT_LENGTH),
        iv: ivSchema,
      }),
    )
    .min(1)
    .max(CONSTANTS.MAX_GROUP_CIPHERTEXTS),
});

const groupTargetPayloadSchema = z.strictObject({
  groupId: z.string().min(1),
  username: usernameSchema,
});

function toValidationResult<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues.map((i) => i.message) };
}

export function validateUsername(input: unknown): ValidationResult<string> {
  return toValidationResult(usernameSchema, input);
}

export function validateUserJoinPayload(
  input: unknown,
): ValidationResult<{ readonly username: string }> {
  return toValidationResult(userJoinPayloadSchema, input);
}

export function validateMessagePayload(
  input: unknown,
): ValidationResult<{ readonly to: string; readonly ciphertext: string; readonly iv: string }> {
  return toValidationResult(messagePayloadSchema, input);
}

export function validateRegisterPayload(
  input: unknown,
): ValidationResult<z.infer<typeof registerPayloadSchema>> {
  return toValidationResult(registerPayloadSchema, input);
}

export function validateLoginPayload(
  input: unknown,
): ValidationResult<z.infer<typeof loginPayloadSchema>> {
  return toValidationResult(loginPayloadSchema, input);
}

export function validateE2eePublicKeyPayload(
  input: unknown,
): ValidationResult<{ readonly to: string; readonly publicKey: string }> {
  return toValidationResult(e2eePublicKeyPayloadSchema, input);
}

export function validateGroupCreatePayload(
  input: unknown,
): ValidationResult<{ readonly name: string; readonly members: readonly string[] }> {
  return toValidationResult(groupCreatePayloadSchema, input);
}

export function validateGroupMessagePayload(input: unknown): ValidationResult<{
  readonly groupId: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
}> {
  return toValidationResult(groupMessagePayloadSchema, input);
}

export function validateGroupTargetPayload(
  input: unknown,
): ValidationResult<{ readonly groupId: string; readonly username: string }> {
  return toValidationResult(groupTargetPayloadSchema, input);
}
