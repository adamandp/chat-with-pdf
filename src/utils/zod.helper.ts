import z from 'zod';

export const baseNumber = (field: string) =>
  z.number({
    error: `🔢 ${field} must be a valid number. No funky math here! 🚫 {Invalid Number}`,
  });

export const baseUUID = (field: string) =>
  z.uuid({
    error: `🆔 ${field} must be a valid UUID. No random gibberish! 🔢 {Invalid UUID}`,
  });

export const baseBoolean = (field: string) =>
  z.boolean({
    error: `⚖️ ${field} must be either true or false. No Schrödinger values! 🐱 {Invalid Boolean}`,
  });

export const baseDate = (field: string) =>
  z.coerce.date({
    error: `📅 ${field} must be a valid date. Time travel not allowed! ⏳ {Invalid Date}`,
  });

export const baseEnum = <T extends readonly [string, ...string[]]>(
  field: string,
  options: T,
) =>
  z.enum(options, {
    error: `🎭 ${field} must be one of the following enum. Choose wisely! 🎯 {Invalid Enum}`,
  });

export const baseArray = <T extends z.ZodType>(field: string, schema: T) =>
  z.array(schema, {
    error: `📦 ${field} must be a list of items. Not just one! 📋 {Invalid Array}`,
  });

export const baseEmail = () =>
  z
    .email({
      error:
        '📧 Invalid email format! Try something like user@example.com ✉️ {Invalid Email}',
    })
    .min(
      4,
      `🔡 email must be at least 4 characters. Keep going! 💪 {Minimum Length}`,
    )
    .max(
      100,
      `🚀 Whoa! email is too long. Maximum allowed is 100 characters! ✍️ {Maximum Length}`,
    );

export const stringMinMax = (field: string, min: number, max: number) =>
  z
    .string({
      error: `📜 ${field} must be a valid text. No weird symbols! 🚫 {Invalid String}`,
    })
    .min(
      min,
      `🔡 ${field} must be at least ${min} characters. Keep going! 💪 {Minimum Length}`,
    )
    .max(
      max,
      `🚀 Whoa! ${field} is too long. Maximum allowed is ${max} characters! ✍️ {Maximum Length}`,
    );
export const NumberMinMax = (field: string, min: number, max: number) =>
  z
    .number({
      error: `🔢 ${field} must be a valid number. No funky math here! 🚫 {Invalid Number}`,
    })
    .min(
      min,
      `🔡 ${field} must be at least ${min} characters. Keep going! 💪 {Minimum Length}`,
    )
    .max(
      max,
      `🚀 Whoa! ${field} is too long. Maximum allowed is ${max} characters! ✍️ {Maximum Length}`,
    );

export const coerceNumber = (field: string) =>
  z.coerce.number({
    error: `🔢 ${field} must be a valid number. No funky math here! 🚫 {Invalid Number}`,
  });

export const coerceNumberMinMax = (field: string, min: number, max: number) =>
  z.coerce
    .number({
      error: `🔢 ${field} must be a valid number. No funky math here! 🚫 {Invalid Number}`,
    })
    .min(
      min,
      `🔡 ${field} must be at least ${min} characters. Keep going! 💪 {Minimum Length}`,
    )
    .max(
      max,
      `🚀 Whoa! ${field} is too long. Maximum allowed is ${max} characters! ✍️ {Maximum Length}`,
    );

export const coerceBoolean = (field: string) =>
  z.coerce.boolean({
    error: `⚖️ ${field} must be either true or false. No Schrödinger values! 🐱 {Invalid Boolean}`,
  });

export const priceMinMax = (field: string, min: number, max: number) =>
  baseNumber(field)
    .min(
      min,
      `💰 ${field} must be at least Rp1.000. Don't be cheap! 🤑 {Price Too Low}`,
    )
    .max(
      max,
      `💰 ${field} must be less than Rp1,000,000. Don't be greedy! 🤑 {Price Too High}`,
    );

export const baseName = (name: string, min: number, max: number) =>
  stringMinMax(name, min, max).regex(/^[A-Za-z\s]+$/, {
    error: `Just letters & spaces, no secret codes! 🤨 {Name Only Letters}`,
  });
