import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Informe um e-mail válido.")),
  password: z.string().min(1, "Informe sua senha."),
});

export const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(2, "Informe seu nome completo.").max(120, "Use até 120 caracteres."),
  officeName: z.string().trim().min(2, "Informe o nome do escritório.").max(160, "Use até 160 caracteres."),
  password: z.string().min(8, "Use pelo menos 8 caracteres.").max(128, "Use até 128 caracteres."),
});

export function authErrorMessage(code?: string) {
  const messages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
    INVALID_PASSWORD: "E-mail ou senha incorretos.",
    USER_NOT_FOUND: "E-mail ou senha incorretos.",
    USER_ALREADY_EXISTS: "Já existe uma conta com este e-mail. Entre para continuar.",
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com este e-mail. Entre para continuar.",
    PASSWORD_TOO_SHORT: "Use pelo menos 8 caracteres na senha.",
    PASSWORD_TOO_LONG: "Use até 128 caracteres na senha.",
    INVALID_EMAIL: "Informe um e-mail válido.",
    TOO_MANY_REQUESTS: "Muitas tentativas. Aguarde um minuto e tente novamente.",
    INVALID_SIGN_UP: "Confira o nome, o escritório, o e-mail e a senha informados.",
  };
  return messages[code ?? ""] ?? "Não foi possível continuar. Tente novamente em instantes.";
}
